/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AddItemModal — "How would you like to start?" choice when adding a menu
 * item. Keeps simple products fast (Start from scratch → existing quick form)
 * while offering the powerful "Use an existing item" path that duplicates a
 * configured item and opens the configuration editor.
 */

import React, { useMemo, useState } from 'react';
import { X, Search, Plus, FilePlus2, Copy, ArrowRight } from 'lucide-react';
import type { Product } from '../../src/types';

type Screen = 'choice' | 'pick';

interface AddItemModalProps {
  products: Product[];
  currencySymbol: string;
  onStartFromScratch: () => void;
  onUseExisting: (source: Product) => void;
  onClose: () => void;
}

export default function AddItemModal({ products, currencySymbol, onStartFromScratch, onUseExisting, onClose }: AddItemModalProps) {
  const [screen, setScreen] = useState<Screen>('choice');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return products.slice(0, 60);
    return products
      .filter((p) => p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query) || p.category.toLowerCase().includes(query))
      .slice(0, 60);
  }, [products, q]);

  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full border border-[var(--color-border-default)] overflow-hidden">
        {/* Header */}
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <h3 className="font-bold text-[var(--color-text-primary)] text-sm">
            {screen === 'choice' ? 'How would you like to start?' : 'Use an existing item'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {screen === 'choice' ? (
          <div className="p-6 space-y-3">
            <button
              onClick={onStartFromScratch}
              className="w-full text-left rounded-xl border-2 border-dashed border-[var(--color-border-default)] hover:border-[var(--brand-color)] p-5 transition-all group cursor-pointer bg-[var(--color-bg-white)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
                  <FilePlus2 className="w-5 h-5 text-[var(--brand-color)]" />
                </div>
                <div>
                  <p className="font-bold text-xs text-[var(--color-text-primary)]">Start from scratch</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Create a new menu item — name, price and a category. Add variants later if you need them.</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setScreen('pick')}
              className="w-full text-left rounded-xl border-2 border-dashed border-[var(--color-border-default)] hover:border-[var(--brand-color)] p-5 transition-all group cursor-pointer bg-[var(--color-bg-white)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                  <Copy className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="font-bold text-xs text-[var(--color-text-primary)]">Use an existing item</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Start with an item that's already configured — sizes, customizations and add-ons come along.</p>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <div className="p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search items to copy..."
                autoFocus
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
              />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onUseExisting(p)}
                  className="w-full text-left rounded-xl border border-[var(--color-border-default)] hover:border-[var(--brand-color)] hover:shadow-sm p-3 transition-all cursor-pointer bg-[var(--color-bg-white)] flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 border border-gray-200 shrink-0 flex items-center justify-center">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <span className="text-sm font-black text-gray-300">{p.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-xs text-[var(--color-text-primary)] truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {p.category} · {currencySymbol}{(p.isCombo ? (p.comboPrice ?? p.price) : p.price).toFixed(2)}
                      {p.variants?.length ? ` · ${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              ))}
              {filtered.length === 0 && <p className="text-[10px] text-gray-400 text-center py-4">No items match “{q}”.</p>}
            </div>
            <div className="mt-3 flex justify-between items-center">
              <button onClick={() => setScreen('choice')} className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer flex items-center gap-1">
                <Plus className="w-3 h-3" /> Back to options
              </button>
              <button onClick={onClose} className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

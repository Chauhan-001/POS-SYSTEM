/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Minus, Plus, ShoppingCart } from 'lucide-react';
import { Product, ProductVariant } from '../src/types';

interface AddOnModalProps {
  product: Product;
  selectedVariant?: ProductVariant;
  currencySymbol: string;
  onConfirm: (product: Product, variant: ProductVariant | undefined, quantity: number, notes: string, addOns: string[]) => void;
  onCancel: () => void;
}

// Category-specific add-on groups — each product gets only relevant customizations
type AddOnItem = { id: string; label: string; price: number };

const ADDON_GROUPS: Record<string, AddOnItem[]> = {
  'Main Course': [
    { id: 'extra_cheese', label: 'Extra Cheese', price: 30 },
    { id: 'extra_toppings', label: 'Extra Toppings', price: 50 },
    { id: 'no_onions', label: 'No Onions', price: 0 },
    { id: 'no_garlic', label: 'No Garlic', price: 0 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
    { id: 'mild', label: 'Mild Spice', price: 0 },
  ],
  Pizza: [
    { id: 'extra_cheese', label: 'Extra Cheese', price: 40 },
    { id: 'extra_toppings', label: 'Extra Toppings', price: 60 },
    { id: 'thin_crust', label: 'Thin Crust', price: 0 },
    { id: 'thick_crust', label: 'Thick Crust', price: 0 },
    { id: 'no_onions', label: 'No Onions', price: 0 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
  ],
  Pasta: [
    { id: 'extra_cheese', label: 'Extra Cheese', price: 30 },
    { id: 'extra_toppings', label: 'Extra Toppings', price: 40 },
    { id: 'al_dente', label: 'Al Dente', price: 0 },
    { id: 'well_done', label: 'Well Done', price: 0 },
    { id: 'no_garlic', label: 'No Garlic', price: 0 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
  ],
  Beverages: [
    { id: 'extra_ice', label: 'Extra Ice', price: 0 },
    { id: 'no_ice', label: 'No Ice', price: 0 },
    { id: 'less_sweet', label: 'Less Sweet', price: 0 },
    { id: 'extra_lime', label: 'Extra Lime', price: 10 },
    { id: 'with_lemon', label: 'With Lemon', price: 5 },
  ],
  'Cold Drinks': [
    { id: 'extra_ice', label: 'Extra Ice', price: 0 },
    { id: 'no_ice', label: 'No Ice', price: 0 },
    { id: 'less_sweet', label: 'Less Sweet', price: 0 },
    { id: 'extra_lime', label: 'Extra Lime', price: 10 },
  ],
  Juices: [
    { id: 'no_ice', label: 'No Ice', price: 0 },
    { id: 'less_sugar', label: 'Less Sugar', price: 0 },
    { id: 'extra_salt', label: 'Extra Salt/Pepper', price: 0 },
    { id: 'with_ginger', label: 'With Ginger', price: 10 },
  ],
  Desserts: [
    { id: 'extra_chocolate', label: 'Extra Chocolate', price: 30 },
    { id: 'less_sugar', label: 'Less Sugar', price: 0 },
    { id: 'with_nuts', label: 'With Nuts', price: 20 },
    { id: 'extra_cream', label: 'Extra Cream', price: 15 },
  ],
  'Ice Cream': [
    { id: 'extra_chocolate', label: 'Extra Chocolate Sauce', price: 25 },
    { id: 'with_nuts', label: 'With Nuts', price: 20 },
    { id: 'extra_cream', label: 'Extra Cream', price: 15 },
    { id: 'with_fruit', label: 'With Fresh Fruit', price: 30 },
  ],
  Soup: [
    { id: 'extra_croutons', label: 'Extra Croutons', price: 10 },
    { id: 'no_croutons', label: 'No Croutons', price: 0 },
    { id: 'extra_dressing', label: 'Extra Dressing', price: 10 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
  ],
  Salad: [
    { id: 'extra_dressing', label: 'Extra Dressing', price: 15 },
    { id: 'no_dressing', label: 'No Dressing', price: 0 },
    { id: 'extra_croutons', label: 'Extra Croutons', price: 10 },
    { id: 'extra_cheese', label: 'Extra Cheese', price: 20 },
  ],
  Starter: [
    { id: 'extra_dip', label: 'Extra Dip', price: 15 },
    { id: 'no_onions', label: 'No Onions', price: 0 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
    { id: 'mild', label: 'Mild', price: 0 },
  ],
  Appetizer: [
    { id: 'extra_dip', label: 'Extra Dip', price: 15 },
    { id: 'no_onions', label: 'No Onions', price: 0 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
    { id: 'mild', label: 'Mild', price: 0 },
  ],
  'Side Dish': [
    { id: 'extra_dip', label: 'Extra Dip', price: 10 },
    { id: 'extra_cheese', label: 'Extra Cheese', price: 20 },
    { id: 'extra_spicy', label: 'Extra Spicy', price: 0 },
  ],
};

// Fallback for unrecognized categories — no add-ons (modal will be skipped)
const FALLBACK_ADDONS: AddOnItem[] = [];

/** Get the relevant add-on options for a given product category */
export function getAddOnsForCategory(category: string): AddOnItem[] {
  // Normalize: try exact match first, then case-insensitive, then partial match
  if (ADDON_GROUPS[category]) return ADDON_GROUPS[category];
  
  const lower = category.toLowerCase();
  for (const [key, addons] of Object.entries(ADDON_GROUPS)) {
    if (key.toLowerCase() === lower) return addons;
    // Partial match: "Cold Coffee" -> check if any key is contained in the category
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return addons;
  }
  
  return FALLBACK_ADDONS;
}

/** Check if a product has any customization options (add-ons, multiple variants) */
export function hasCustomizationOptions(product: { category: string; variants?: { length: number } }): boolean {
  const hasMultipleVariants = product.variants && product.variants.length > 1;
  const hasCategoryAddOns = getAddOnsForCategory(product.category).length > 0;
  return hasMultipleVariants || hasCategoryAddOns;
}

export default function AddOnModal({ product, selectedVariant: initialVariant, currencySymbol, onConfirm, onCancel }: AddOnModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(initialVariant);

  const productAddOns = getAddOnsForCategory(product.category);
  const hasVariants = product.variants && product.variants.length > 0;
  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const addOnTotal = selectedAddOns.reduce((sum, id) => {
    const opt = productAddOns.find(o => o.id === id);
    return sum + (opt?.price || 0);
  }, 0);
  const lineTotal = (displayPrice + addOnTotal) * quantity;

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    const addOnLabels = selectedAddOns
      .map(id => productAddOns.find(o => o.id === id)?.label)
      .filter(Boolean) as string[];
    
    const notesText = [notes, ...addOnLabels].filter(Boolean).join(', ');
    onConfirm(product, selectedVariant, quantity, notesText, selectedAddOns);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <span className="text-base font-black text-gray-400">{(product.name || '?').charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">{product.name}</h3>
              <p className="text-[11px] font-mono font-semibold text-[var(--brand-color)]">{currencySymbol}{displayPrice.toFixed(2)}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Variant Selection */}
          {hasVariants && product.variants!.length > 1 && (
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Size / Variant</label>
              <div className="flex flex-wrap gap-2">
                {product.variants!.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => setSelectedVariant(v)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      selectedVariant?.name === v.name
                        ? 'bg-[var(--brand-color)] text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                    }`}
                  >
                    {v.name} — {currencySymbol}{v.price.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity Selector */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Quantity</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5 text-gray-600" />
              </button>
              <span className="w-10 text-center text-sm font-bold font-mono">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
                className="w-8 h-8 rounded-lg bg-[var(--brand-color)] hover:bg-[#003a9e] text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Add-ons — only show if this category has any */}
          {productAddOns.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Add-ons & Preferences</label>
            <div className="grid grid-cols-2 gap-2">
              {productAddOns.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => toggleAddOn(opt.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${
                    selectedAddOns.includes(opt.id)
                      ? 'bg-blue-50 border-[var(--brand-color)] text-[var(--brand-color)]'
                      : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span>{opt.label}</span>
                  {opt.price > 0 && (
                    <span className="text-[9px] font-mono text-gray-400">+{currencySymbol}{opt.price}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Special Instructions</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Less oil, well done, no ice..."
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30 focus:border-[var(--brand-color)] resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50">
          <div>
            <p className="text-[10px] text-gray-400 font-medium">Line Total</p>
            <p className="text-sm font-bold font-mono text-gray-900">{currencySymbol}{lineTotal.toFixed(2)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[#003a9e] transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Add to Bill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

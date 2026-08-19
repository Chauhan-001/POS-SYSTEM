/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConfiguredItemModal — the dynamic POS configuration selector (Phase 3).
 *
 * Renders a product's RESOLVED configuration (variants, customizations,
 * add-ons) as groups with options. It is 100% data-driven: a pizza shows
 * size/crust/toppings, a burger shows patty/cheese/sauce, a biryani shows
 * portion/spice/add-ons — from the SAME component, no hardcoded product types.
 *
 * Pricing is computed locally and instantly (no network per click) with the
 * pricing-engine mirror; the selection is validated before Add with the
 * Phase 1 validator mirror. The backend revalidates + reprices at bill time.
 */

import { useMemo, useState } from 'react';
import { X, Minus, Plus, ShoppingCart } from 'lucide-react';
import type { ResolvedProductConfig, ResolvedConfigGroup, ResolvedConfigOption } from '../src/types';
import { calculateLineItemPrice, ConfigSelection } from '../src/lib/pricingEngine';
import { validateSelection, buildConfiguredCartItem, toggleOption, setOptionQuantity } from '../src/lib/configSelection';

interface ConfiguredItemModalProps {
  product: { id: string; name: string; image?: string; category?: string; price?: number };
  resolved: ResolvedProductConfig;
  currencySymbol: string;
  origin: 'online' | 'offline';
  existing?: {
    quantity: number;
    notes?: string;
    configuration: ConfigSelection;
  } | null;
  onConfirm: (item: any) => void;
  onCancel: () => void;
}

/** Read a selection entry's selected option ids for a group. */
function selectedIdsFor(selection: ConfigSelection | undefined, groupId: string): string[] {
  return selection?.selections?.find((s) => s.groupId === groupId)?.optionIds ?? [];
}

/** Read an add-on quantity for a group+option. */
function qtyFor(selection: ConfigSelection | undefined, groupId: string, optionId: string): number {
  return selection?.selections?.find((s) => s.groupId === groupId)?.quantities?.[optionId] ?? 1;
}


function GroupCard({ group, selection, onToggle, onQty, currencySymbol }: {
  group: ResolvedConfigGroup;
  selection: ConfigSelection;
  onToggle: (groupId: string, optionId: string) => void;
  onQty: (groupId: string, optionId: string, qty: number, option: ResolvedConfigOption) => void;
  currencySymbol: string;
}) {
  const selected = selectedIdsFor(selection, group.id);
  const isAddon = group.type === 'ADD_ON_GROUP';
  const requiredLabel = group.required ? 'REQUIRED' : group.minSelections > 0 ? `MIN ${group.minSelections}` : 'OPTIONAL';

  return (
    <div className="border border-[var(--color-border-default)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-bold text-[var(--color-text-primary)]">{group.name}</p>
          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">{requiredLabel}</p>
        </div>
        {group.maxSelections != null && group.maxSelections > 1 && (
          <span className="text-[9px] font-mono text-gray-400">
            {selected.length}/{group.maxSelections}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {group.options.map((option) => {
          const isOn = selected.includes(option.id);
          const qty = isAddon ? qtyFor(selection, group.id, option.id) : 1;
          const priceText = isAddon
            ? `${currencySymbol}${(option.price ?? 0).toFixed(2)}`
            : (option.priceDelta ?? 0) > 0
              ? `+${currencySymbol}${(option.priceDelta ?? 0).toFixed(2)}`
              : currencySymbol + '0.00';
          return (
            <div key={option.id} className="flex flex-col gap-1">
              <button
                onClick={() => onToggle(group.id, option.id)}
                disabled={option.active === false}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                  option.active === false
                    ? 'opacity-40 cursor-not-allowed border-[var(--color-border-default)] text-gray-400'
                    : isOn
                      ? 'bg-[var(--brand-color)] text-white shadow-sm border-transparent'
                      : 'bg-[var(--color-bg-white)] text-gray-600 hover:bg-gray-100 border-[var(--color-border-default)]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {!isAddon && (
                    <span className={`w-3 h-3 rounded-full border ${isOn ? 'border-white bg-white/25' : 'border-gray-300'}`} />
                  )}
                  {option.name}
                  <span className={`${isOn ? 'text-white/80' : 'text-gray-400'}`}>{priceText}</span>
                </span>
              </button>
              {isAddon && isOn && (
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => onQty(group.id, option.id, qty - 1, option)}
                    className="p-0.5 text-gray-500 hover:text-[var(--brand-color)] rounded cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-[10px] font-bold font-mono min-w-[16px] text-center">{qty}</span>
                  <button
                    onClick={() => onQty(group.id, option.id, qty + 1, option)}
                    className="p-0.5 text-gray-500 hover:text-[var(--brand-color)] rounded cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConfiguredItemModal({
  product, resolved, currencySymbol, origin, existing, onConfirm, onCancel,
}: ConfiguredItemModalProps) {
  const [quantity, setQuantity] = useState(existing?.quantity ?? 1);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [selection, setSelection] = useState<ConfigSelection>(() => {
    if (existing?.configuration?.selections?.length) return existing.configuration;
    // Default: auto-select SINGLE required groups' first active option so a
    // cashier can add a configured item with one tap when defaults are sane.
    const groups = [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups];
    const selections = groups
      .filter((g) => g.selectionMode === 'SINGLE' && g.required)
      .map((g) => ({ groupId: g.id, optionIds: [g.options.find((o) => o.active !== false)?.id].filter(Boolean) as string[] }))
      .filter((s) => s.optionIds.length > 0);
    return { selections };
  });

  const price = useMemo(() => calculateLineItemPrice(resolved, selection, quantity), [resolved, selection, quantity]);
  const validation = useMemo(() => validateSelection(resolved, selection), [resolved, selection]);
  const canAdd = validation.valid && price.grossItemPrice >= 0;

  const handleToggle = (groupId: string, optionId: string) => {
    const group = [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups].find((g) => g.id === groupId);
    if (!group) return;
    setSelection((prev) => toggleOption(prev, group, optionId));
  };

  const handleQty = (groupId: string, optionId: string, qty: number, option: ResolvedConfigOption) => {
    setSelection((prev) => setOptionQuantity(prev, groupId, optionId, qty, option));
  };

  const handleConfirm = () => {
    if (!canAdd) return;
    const item = buildConfiguredCartItem(resolved, selection, quantity, origin, existing ? undefined : undefined, product);
    onConfirm({ ...item, notes: notes || undefined });
  };

  const groups = [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups];
  const hasAnyGroup = groups.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl border border-[var(--color-border-default)] w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
              {product.image ? (
                <img src={product.image} alt={product.name} className="w-full h-full object-cover" loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="text-base font-black text-gray-400">{(product.name || '?').charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] leading-tight">{product.name}</h3>
              <p className="text-[11px] font-mono font-semibold text-[var(--brand-color)]">
                {currencySymbol}{price.grossItemPrice.toFixed(2)}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Groups */}
        <div className="px-5 py-4 space-y-3 max-h-[52vh] overflow-y-auto">
          {!hasAnyGroup && (
            <p className="text-[11px] text-gray-500 text-center py-6">This item has no configuration options.</p>
          )}
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} selection={selection}
              onToggle={handleToggle} onQty={handleQty} currencySymbol={currencySymbol} />
          ))}

          {/* Quantity */}
          <div className="flex items-center justify-between pt-1">
            <label className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Quantity</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-bold font-mono min-w-[24px] text-center">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="w-7 h-7 rounded-lg bg-[var(--brand-color)]/10 hover:bg-[var(--brand-color)]/20 text-[var(--brand-color)] flex items-center justify-center cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notes */}
          <input
            type="text"
            placeholder="Add note (e.g. no onions)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
          />

          {/* Validation errors */}
          {!validation.valid && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
              {validation.errors.slice(0, 3).map((e, i) => (
                <p key={i} className="text-[10px] font-semibold text-amber-700">• {e.message}</p>
              ))}
              {validation.errors.length > 3 && (
                <p className="text-[10px] text-amber-600">+{validation.errors.length - 3} more</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--color-border-default)] flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] text-gray-400 uppercase tracking-wider">Line total</p>
            <p className="text-base font-extrabold font-mono text-[var(--color-text-primary)]">
              {currencySymbol}{price.lineTotal.toFixed(2)}
            </p>
          </div>
          <button
            onClick={handleConfirm}
            disabled={!canAdd}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              canAdd
                ? 'bg-[var(--brand-color)] text-white shadow-md hover:opacity-90'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {existing ? 'Update Item' : 'Add to Cart'}
          </button>
        </div>
      </div>
    </div>
  );
}

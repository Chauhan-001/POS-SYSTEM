/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CartItemRow — Memoized cart item row for the CartPanel.
 * Extracted to avoid re-rendering all cart items when only one item changes.
 */
import { memo, useState } from 'react';
import { Minus, Plus, Trash, AlertTriangle, Lock } from 'lucide-react';
import type { CartItem } from '../src/types';

// ─── Props ──────────────────────────────────────────────────────

export interface CartItemRowProps {
  item: CartItem;
  currencySymbol: string;
  enableOrderNotes: boolean;
  onAdjustQuantity: (id: string, delta: number) => void;
  onDeleteItem: (id: string) => void;
  onUpdateItemNotes: (itemId: string, notes: string) => void;
}

// ─── Comparator ────────────────────────────────────────────────

function areEqual(prev: CartItemRowProps, next: CartItemRowProps): boolean {
  const a = prev.item;
  const b = next.item;
  // Compare primitive fields of the item
  if (a.id !== b.id) return false;
  if (a.quantity !== b.quantity) return false;
  if (a.price !== b.price) return false;
  if (a.notes !== b.notes) return false;
  if ((a.isFree ?? false) !== (b.isFree ?? false)) return false;
  if ((a.kotPrinted ?? false) !== (b.kotPrinted ?? false)) return false;
  // Compare product identity (name affects display, image for thumbnail)
  if (a.product?.id !== b.product?.id) return false;
  if (a.product?.name !== b.product?.name) return false;
  if (a.product?.image !== b.product?.image) return false;
  // Compare variant name
  if ((a.selectedVariant?.name ?? '') !== (b.selectedVariant?.name ?? '')) return false;
  // Compare config props
  if (prev.currencySymbol !== next.currencySymbol) return false;
  if (prev.enableOrderNotes !== next.enableOrderNotes) return false;
  // Callbacks are stable (useCallback-wrapped) — reference equality is sufficient
  if (prev.onAdjustQuantity !== next.onAdjustQuantity) return false;
  if (prev.onDeleteItem !== next.onDeleteItem) return false;
  if (prev.onUpdateItemNotes !== next.onUpdateItemNotes) return false;
  return true;
}

// ─── Component ─────────────────────────────────────────────────

function CartItemRow({
  item, currencySymbol, enableOrderNotes,
  onAdjustQuantity, onDeleteItem, onUpdateItemNotes,
}: CartItemRowProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const locked = !!item.kotPrinted;

  const handleDeleteClick = () => {
    if (locked) return;
    if (confirmDeleteId === item.id) {
      onDeleteItem(item.id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(item.id);
      setTimeout(() => {
        setConfirmDeleteId(current => current === item.id ? null : current);
      }, 3000);
    }
  };

  return (
    <div className={`bg-gray-50 rounded-lg p-2.5 border border-[#e1e2ed] group transition-all ${locked ? 'opacity-80 border-[#c3c6d7] bg-gray-100' : 'hover:border-[var(--brand-color)]/30'}`}>
      <div className="flex justify-between items-start">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 border border-[#e1e2ed] bg-white flex items-center justify-center">
            {item.product.image
              ? <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
              : <div className="w-3 h-3 rounded-sm bg-[var(--brand-color)]/10" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#191b23] truncate">
              {item.isFree && <span className="text-emerald-600 mr-1">[FREE]</span>}
              {item.product.name}
            </p>
            {item.selectedVariant && <p className="text-[9px] text-gray-500">{item.selectedVariant.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          {locked ? (
            <span className="flex items-center gap-1 text-[8px] font-bold text-gray-500 bg-gray-200/70 rounded-full px-1.5 py-0.5" title="Already sent to kitchen — locked">
              <Lock className="w-2.5 h-2.5" />KOT
            </span>
          ) : (
            <>
              <button
                onClick={() => onAdjustQuantity(item.id, -1)}
                className="p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold font-mono min-w-[20px] text-center">{item.quantity}</span>
              <button
                onClick={() => onAdjustQuantity(item.id, 1)}
                className="p-0.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDeleteClick}
                className={`p-0.5 rounded ml-1 cursor-pointer transition-all ${
                  confirmDeleteId === item.id
                    ? 'bg-red-100 text-red-600 animate-pulse'
                    : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                }`}
                title={confirmDeleteId === item.id ? 'Tap again to confirm delete' : 'Delete item'}
              >
                {confirmDeleteId === item.id
                  ? <AlertTriangle className="w-3.5 h-3.5" />
                  : <Trash className="w-3.5 h-3.5" />
                }
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-[10px] font-mono text-gray-500">
          {currencySymbol}{item.price.toFixed(2)} × {item.quantity}
        </span>
        <span className="text-xs font-bold font-mono">
          {currencySymbol}{(item.price * item.quantity).toFixed(2)}
        </span>
      </div>
      {enableOrderNotes && (
        <input
          type="text"
          placeholder="Add note..."
          value={item.notes || ''}
          disabled={locked}
          className={`mt-1 w-full px-1.5 py-0.5 text-[9px] border border-dashed border-gray-300 rounded focus:outline-none focus:border-[var(--brand-color)] focus:ring-0 ${locked ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateItemNotes(item.id, e.target.value)}
        />
      )}
      {item.notes && (
        <p className="text-[9px] text-gray-400 italic mt-0.5">Note: {item.notes}</p>
      )}
    </div>
  );
}

export default memo(CartItemRow, areEqual);

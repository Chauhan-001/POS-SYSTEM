/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillActionModal — Refund / Void a completed bill.
 * Requires a reason and an Owner/Manager PIN (verified server-side) so every
 * financial correction is accountable. Refund supports partial (per-item
 * quantity) or full refund; Void is an all-or-nothing bill reversal.
 */

import { useEffect, useState } from 'react';
import { Undo2, Ban, ShieldCheck, X, Lock } from 'lucide-react';
import type { Bill } from '../../types';

interface BillActionModalProps {
  isOpen: boolean;
  mode: 'refund' | 'void';
  bill: Bill | null;
  currencySymbol: string;
  onClose: () => void;
  onSubmit: (payload: {
    items?: Array<{ menuItemId?: string; itemName?: string; quantity?: number }>;
    reason: string;
    managerPin: string;
  }) => void;
  isProcessing?: boolean;
}

export default function BillActionModal({
  isOpen, mode, bill, currencySymbol, onClose, onSubmit, isProcessing,
}: BillActionModalProps) {
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Reset state each time the modal opens for a new bill
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setManagerPin('');
      setQuantities({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bill?.id]);

  if (!isOpen || !bill) return null;

  const isRefund = mode === 'refund';
  const activeItems = Array.isArray(bill.items) ? bill.items.filter((i: any) => !i.cancelled) : [];
  const qtyFor = (item: any): number => quantities[item.id] ?? (item.quantity ?? 0);
  const refundTotal = activeItems.reduce((s: number, item: any) => {
    const q = Math.min(Math.max(0, qtyFor(item)), item.quantity ?? 0);
    return s + q * (item.price || 0);
  }, 0);

  const canSubmit = reason.trim().length > 0 && managerPin.trim().length >= 4 &&
    (!isRefund || refundTotal > 0);

  const handleSubmit = () => {
    const items = isRefund
      ? activeItems
          .map((item: any) => ({
            menuItemId: item.product?.id || item.menuItemId,
            itemName: item.product?.name || item.itemName,
            quantity: Math.min(Math.max(0, qtyFor(item)), item.quantity ?? 0),
          }))
          .filter((it: any) => it.quantity > 0)
      : undefined;
    onSubmit({ items, reason: reason.trim(), managerPin: managerPin.trim() });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[#e1e2ed] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b border-[#e1e2ed] flex justify-between items-center ${isRefund ? 'bg-purple-50' : 'bg-red-50'}`}>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isRefund ? 'bg-purple-100' : 'bg-red-100'}`}>
              {isRefund ? <Undo2 className="w-4 h-4 text-purple-600" /> : <Ban className="w-4 h-4 text-red-600" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#191b23]">{isRefund ? 'Refund Bill' : 'Void Bill'}</h3>
              <p className="text-[10px] text-gray-500 font-mono">{bill.invoiceNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Bill summary */}
          <div className="bg-gray-50 rounded-lg border border-[#e1e2ed] p-3 flex justify-between text-xs">
            <div>
              <p className="text-gray-500">Bill Total</p>
              <p className="font-mono font-bold text-[#191b23]">{currencySymbol}{bill.grandTotal.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-500">{bill.paymentMethod} · {bill.date}</p>
              <p className="text-[10px] text-gray-400">by {bill.cashierName}</p>
            </div>
          </div>

          {/* Refund item quantities */}
          {isRefund && (
            <div>
              <p className="text-[9px] font-bold uppercase text-gray-400 mb-1.5">Select quantities to refund</p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {activeItems.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-3">No refundable items on this bill.</p>
                )}
                {activeItems.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded-lg border border-[#e1e2ed] px-2.5 py-1.5">
                    <span className="text-xs font-semibold text-[#191b23] flex-1 truncate">
                      {item.product?.name || item.itemName || 'Item'}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{currencySymbol}{(item.price || 0).toFixed(2)}</span>
                    <input
                      type="number"
                      min={0}
                      max={item.quantity ?? 1}
                      value={qtyFor(item)}
                      onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: Math.max(0, Math.min(item.quantity ?? 1, Number(e.target.value) || 0)) }))}
                      className="w-14 px-2 py-1 border border-[#c3c6d7] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                    />
                    <span className="text-[9px] text-gray-400">/ {item.quantity}</span>
                  </div>
                ))}
              </div>
              {refundTotal > 0 && (
                <p className="text-right text-xs font-bold mt-2 text-purple-700">
                  Refund Amount: {currencySymbol}{refundTotal.toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">
              {isRefund ? 'Refund Reason' : 'Void Reason'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isRefund ? 'e.g. Customer returned item / wrong order' : 'e.g. Duplicate bill / wrong payment'}
              className="w-full px-3 py-2 border border-[#c3c6d7] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              autoFocus
            />
          </div>

          {/* Manager PIN */}
          <div>
            <label className="flex items-center gap-1 text-[9px] font-bold uppercase text-gray-400 mb-1">
              <ShieldCheck className="w-3 h-3" /> Manager / Owner PIN <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="password"
                inputMode="numeric"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="Enter authorized PIN"
                className="w-full pl-9 pr-3 py-2 border border-[#c3c6d7] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <p className="text-[9px] text-gray-400 mt-1">
              Verified against active Owner/Manager accounts. This action is audit-logged.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e1e2ed] flex gap-3 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white transition-all cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isProcessing}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ml-auto cursor-pointer ${
              canSubmit && !isProcessing
                ? isRefund
                  ? 'bg-purple-600 text-white hover:bg-purple-700 hover:shadow-md'
                  : 'bg-red-600 text-white hover:bg-red-700 hover:shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isProcessing ? 'Processing...' : (isRefund ? `Refund ${currencySymbol}${refundTotal.toFixed(2)}` : 'Void Bill')}
          </button>
        </div>
      </div>
    </div>
  );
}

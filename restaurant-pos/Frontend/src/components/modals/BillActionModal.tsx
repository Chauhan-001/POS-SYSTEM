/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillActionModal — Void a completed bill.
 * Requires a reason and an Owner/Manager PIN (verified server-side) so every
 * financial correction is accountable. Void is an all-or-nothing bill
 * reversal. (Bill refunds were removed from the POS.)
 */

import { useEffect, useState } from 'react';
import { Ban, ShieldCheck, X, Lock } from 'lucide-react';
import type { Bill } from '../../types';

interface BillActionModalProps {
  isOpen: boolean;
  bill: Bill | null;
  currencySymbol: string;
  onClose: () => void;
  onSubmit: (payload: {
    reason: string;
    managerPin: string;
  }) => void;
  isProcessing?: boolean;
}

export default function BillActionModal({
  isOpen, bill, currencySymbol, onClose, onSubmit, isProcessing,
}: BillActionModalProps) {
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');

  // Reset state each time the modal opens for a new bill
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setManagerPin('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bill?.id]);

  if (!isOpen || !bill) return null;

  const canSubmit = reason.trim().length > 0 && managerPin.trim().length >= 4;

  const handleSubmit = () => {
    onSubmit({ reason: reason.trim(), managerPin: managerPin.trim() });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[var(--color-border-default)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-border-default)] flex justify-between items-center bg-red-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-100">
              <Ban className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--color-text-primary)]">Void Bill</h3>
              <p className="text-[10px] text-gray-500 font-mono">{bill.invoiceNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Bill summary */}
          <div className="bg-gray-50 rounded-lg border border-[var(--color-border-default)] p-3 flex justify-between text-xs">
            <div>
              <p className="text-gray-500">Bill Total</p>
              <p className="font-mono font-bold text-[var(--color-text-primary)]">{currencySymbol}{bill.grandTotal.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-500">{bill.paymentMethod} · {bill.date}</p>
              <p className="text-[10px] text-gray-400">by {bill.cashierName}</p>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">
              Void Reason <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate bill / wrong payment"
              className="w-full px-3 py-2 border border-[var(--color-border-input)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                className="w-full pl-9 pr-3 py-2 border border-[var(--color-border-input)] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <p className="text-[9px] text-gray-400 mt-1">
              Verified against active Owner/Manager accounts. This action is audit-logged.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border-default)] flex gap-3 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-[var(--color-bg-white)] transition-all cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isProcessing}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ml-auto cursor-pointer ${
              canSubmit && !isProcessing
                ? 'bg-[var(--color-red-600-solid)] text-white hover:bg-[var(--color-red-700-solid)] hover:shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isProcessing ? 'Processing...' : 'Void Bill'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split Payment Modal — allows splitting bill across multiple payment methods.
 */

import { ArrowLeftRight, DollarSign, CreditCard, Smartphone, Wallet, X } from 'lucide-react';

interface SplitPaymentModalProps {
  isOpen: boolean;
  splitDetails: { cashAmount: number; cardAmount: number; upiAmount: number; walletAmount: number };
  grandTotal: number;
  currencySymbol: string;
  onSplitChange: (details: any) => void;
  onClose: () => void;
  onProceed: () => void;
}

export default function SplitPaymentModal({
  isOpen, splitDetails, grandTotal, currencySymbol, onSplitChange, onClose, onProceed,
}: SplitPaymentModalProps) {
  if (!isOpen) return null;

  const updateSplit = (key: string, value: number) => {
    onSplitChange({ ...splitDetails, [key]: Math.max(0, value) });
  };

  const totalAllocated = (splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0);
  const isBalanced = Math.abs(totalAllocated - grandTotal) < 0.01;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 border border-[#e1e2ed]" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <ArrowLeftRight className="w-4 h-4 text-[var(--brand-color)]" />
            Split Payment
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-[#e1e2ed]">
            <span className="text-xs font-semibold text-gray-600">Grand Total</span>
            <span className="text-sm font-bold font-mono text-[#191b23]">{currencySymbol}{grandTotal.toFixed(2)}</span>
          </div>

          {/* Cash */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <DollarSign className="w-3.5 h-3.5 text-green-600" />
              Cash
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono w-6">{currencySymbol}</span>
              <input
                type="number"
                value={splitDetails.cashAmount || 0}
                onChange={(e) => updateSplit('cashAmount', parseFloat(e.target.value) || 0)}
                className="flex-1 px-3 py-1.5 border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Card */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <CreditCard className="w-3.5 h-3.5 text-blue-600" />
              Card
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono w-6">{currencySymbol}</span>
              <input
                type="number"
                value={splitDetails.cardAmount || 0}
                onChange={(e) => updateSplit('cardAmount', parseFloat(e.target.value) || 0)}
                className="flex-1 px-3 py-1.5 border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* UPI */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <Smartphone className="w-3.5 h-3.5 text-purple-600" />
              UPI
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono w-6">{currencySymbol}</span>
              <input
                type="number"
                value={splitDetails.upiAmount || 0}
                onChange={(e) => updateSplit('upiAmount', parseFloat(e.target.value) || 0)}
                className="flex-1 px-3 py-1.5 border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Wallet */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <Wallet className="w-3.5 h-3.5 text-amber-600" />
              Wallet
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono w-6">{currencySymbol}</span>
              <input
                type="number"
                value={splitDetails.walletAmount || 0}
                onChange={(e) => updateSplit('walletAmount', parseFloat(e.target.value) || 0)}
                className="flex-1 px-3 py-1.5 border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Allocation Status */}
          <div className={`rounded-lg p-3 border text-xs ${
            isBalanced
              ? 'bg-green-50 border-green-200 text-green-700'
              : totalAllocated > grandTotal
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            <div className="flex justify-between items-center">
              <span className="font-semibold">Allocated</span>
              <span className="font-mono font-bold">{currencySymbol}{totalAllocated.toFixed(2)} / {currencySymbol}{grandTotal.toFixed(2)}</span>
            </div>
            {!isBalanced && (
              <p className="text-[10px] mt-1">
                {totalAllocated > grandTotal
                  ? 'Total allocated exceeds grand total. Please adjust.'
                  : `Remaining: ${currencySymbol}${(grandTotal - totalAllocated).toFixed(2)}`}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e1e2ed] flex gap-3 justify-end bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white hover:text-[#191b23] transition-all cursor-pointer">
            Cancel
          </button>
          <button
            onClick={onProceed}
            disabled={!isBalanced}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
              isBalanced
                ? 'bg-[var(--brand-color)] text-white hover:bg-[#003ea8] hover:shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Set Split Payment
          </button>
        </div>
      </div>
    </div>
  );
}

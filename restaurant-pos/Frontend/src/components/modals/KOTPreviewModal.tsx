/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KOT Preview Modal — shows items about to be sent to the kitchen for confirmation.
 */

import { Printer, X, CookingPot, ChevronRight, AlertCircle } from 'lucide-react';

interface KOTPreviewData {
  items: any[];
  allItems?: any[];
  kotType: 'Original' | 'Additional';
  onConfirm: () => void;
  onConfirmMerge?: () => void;
}

interface KOTPreviewModalProps {
  isOpen: boolean;
  data: KOTPreviewData | null;
  onClose: () => void;
}

export default function KOTPreviewModal({ isOpen, data, onClose }: KOTPreviewModalProps) {
  if (!isOpen || !data) return null;

  const { items, allItems, kotType, onConfirm, onConfirmMerge } = data;
  const totalItems = items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[#e1e2ed]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-gradient-to-r from-orange-50 to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <CookingPot className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#191b23]">Send to Kitchen</h3>
              <p className="text-[10px] text-gray-500">
                {kotType === 'Original' ? 'First KOT' : 'Additional KOT'} · {totalItems} item{totalItems !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* KOT Type Badge */}
          <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
            kotType === 'Original'
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            <Printer className="w-3 h-3" />
            {kotType === 'Original' ? 'New KOT' : 'Additional Items'}
          </div>

          {/* Pending Items */}
          <div className="bg-gray-50 rounded-lg border border-[#e1e2ed] divide-y divide-[#e1e2ed]">
            <div className="px-3 py-1.5 bg-gray-100/50 rounded-t-lg">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Pending Items</p>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No pending items</p>
            ) : (
              items.map((item: any, idx: number) => (
                <div key={item.id || idx} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono font-bold text-orange-600 bg-orange-100 rounded w-5 h-5 flex items-center justify-center shrink-0">
                      {item.quantity || 1}
                    </span>
                    <span className="text-xs font-medium text-[#191b23] truncate">
                      {item.product?.name || item.name || 'Item'}
                    </span>
                    {item.notes && (
                      <span className="text-[9px] text-gray-400 italic truncate max-w-[100px]">({item.notes})</span>
                    )}
                  </div>
                  {item.selectedVariant && (
                    <span className="text-[10px] text-gray-400 font-mono shrink-0 ml-2">{item.selectedVariant.name}</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Previously Printed (if any) */}
          {allItems && allItems.length > 0 && (
            <div className="bg-blue-50/50 rounded-lg border border-blue-200 divide-y divide-blue-200/50">
              <div className="px-3 py-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 text-blue-500" />
                <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Previously Printed</p>
              </div>
              {allItems.slice(0, 5).map((item: any, idx: number) => (
                <div key={`prev-${idx}`} className="flex items-center justify-between px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-blue-500">{item.quantity || 1}x</span>
                    <span className="text-[11px] text-blue-700">{item.product?.name || item.name || 'Item'}</span>
                  </div>
                </div>
              ))}
              {allItems.length > 5 && (
                <p className="px-3 py-1 text-[10px] text-blue-400 italic">+{allItems.length - 5} more items</p>
              )}
            </div>
          )}
        </div>

        {/* Footer Action Buttons */}
        <div className="p-4 border-t border-[#e1e2ed] flex gap-3 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white hover:text-[#191b23] transition-all cursor-pointer"
          >
            Cancel
          </button>
          {onConfirmMerge ? (
            <div className="flex gap-2 ml-auto">
              <button
                onClick={onConfirm}
                className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition-all shadow-sm cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Send as Additional
              </button>
              <button
                onClick={onConfirmMerge}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] transition-all shadow-sm cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Merge & Print All
              </button>
            </div>
          ) : (
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 px-5 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] transition-all shadow-sm hover:shadow-md ml-auto cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Send to Kitchen ({totalItems})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

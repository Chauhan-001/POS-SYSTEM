/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, Printer, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import { KOTRecord, KOTType, CartItem, Order } from '../src/types';
import ThermalKOT from './ThermalKOT';
import { formatKOTTimestamp } from '../src/utils/kotTime';

interface KOTModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  kotRecords: KOTRecord[];
  cartItems: CartItem[];
  onPrintKOT: (type: KOTType) => void;
  onReprintKOT: (kotId: string) => void;
  onPrintPaperKOT?: (kotId: string) => void;
  settings: any;
  currentEmployee: any;
}

const KOT_TYPE_STYLES: Record<KOTType, { label: string; color: string }> = {
  'Original': { label: 'ORIGINAL KOT', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  'Additional': { label: 'ADDITIONAL KOT', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  'Reprint': { label: 'REPRINT KOT', color: 'bg-red-100 text-red-800 border-red-200' },
};

export default function KOTModal({
  isOpen, onClose, order, kotRecords, cartItems, onPrintKOT, onReprintKOT, onPrintPaperKOT, settings, currentEmployee
}: KOTModalProps) {
  if (!isOpen || !order) return null;

  // Compute pending items from actual cart items minus already-printed quantities
  const printedQty = new Map<string, number>();
  kotRecords.forEach(kot => {
    kot.items.forEach(item => {
      printedQty.set(item.id, (printedQty.get(item.id) || 0) + item.quantity);
    });
  });

  const pendingItems: CartItem[] = [];
  cartItems.forEach(item => {
    const printed = printedQty.get(item.id) || 0;
    const remaining = item.quantity - printed;
    if (remaining > 0) pendingItems.push({ ...item, quantity: remaining });
  });
  const lastKOT = kotRecords.length > 0 ? kotRecords[kotRecords.length - 1] : null;
  const nextKotNumber = kotRecords.length + 1;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-700" />
            <h2 className="font-bold text-sm text-gray-900">Kitchen Order Ticket (KOT)</h2>
            <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full">
              Order #{order.orderNumber}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* KOT Action Buttons */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex gap-2 shrink-0">
          {pendingItems.length > 0 && (
            <button
              onClick={() => onPrintKOT(kotRecords.length > 0 ? 'Additional' : 'Original')}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print KOT #{nextKotNumber}
              {kotRecords.length > 0 && <span className="text-[9px] opacity-70">(Additional)</span>}
            </button>
          )}
          {kotRecords.length > 0 && (
            <button
              onClick={() => onReprintKOT(kotRecords[kotRecords.length - 1].id)}
              className="flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer border border-amber-200"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reprint Last KOT
            </button>
          )}
        </div>

        {/* KOT History Section */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* KOT Records */}
          {kotRecords.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase text-gray-500 mb-3 tracking-wider">KOT History ({kotRecords.length})</h3>
              <div className="space-y-3">
                {kotRecords.map((kot) => {
                  const style = KOT_TYPE_STYLES[kot.type];
                  return (
                    <div key={kot.id} className="bg-white border border-gray-200 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${style.color}`}>
                              {style.label}
                            </span>
                            <span className="font-bold text-sm text-gray-900">KOT #{kot.kotNumber}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-[10px] text-gray-500 block">{formatKOTTimestamp(kot.printedAt)}</span>
                              <span className="text-[9px] text-gray-400">by {kot.printedBy}</span>
                            </div>
                            {onPrintPaperKOT && (
                              <button
                                onClick={() => onPrintPaperKOT(kot.id)}
                                title="Print this KOT (works offline)"
                                className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                      {/* KOT Items */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] font-bold text-gray-500 uppercase pb-1 border-b border-gray-100">
                          <span className="w-1/2">Item</span>
                          <span className="w-16 text-center">Qty</span>
                          <span className="w-20 text-right">Amount</span>
                        </div>
                        {kot.items.map(item => (
                          <div key={item.id} className="flex justify-between text-[11px] py-1 border-b border-gray-50 last:border-0">
                            <span className="w-1/2 font-semibold text-gray-800">
                              {item.product.name}
                              {item.selectedVariant && (
                                <span className="text-[9px] text-gray-500 ml-1">({item.selectedVariant.name})</span>
                              )}
                              {item.notes && (
                                <span className="block text-[9px] text-amber-600 italic">📝 {item.notes}</span>
                              )}
                            </span>
                            <span className="w-16 text-center font-medium">{item.quantity}</span>
                            <span className="w-20 text-right font-medium">{settings.currencySymbol || '₹'}{(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      {kot.note && (
                        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg p-2 text-[10px] text-amber-800 font-medium">
                          📋 {kot.note}
                        </div>
                      )}

                      {kot.type === 'Reprint' && (
                        <div className="mt-2 flex items-center gap-1 text-[9px] text-red-600 font-bold">
                          <RefreshCw className="w-3 h-3" />
                          REPRINTED
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pending Items (not yet sent to kitchen) */}
          {pendingItems.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase text-amber-600 mb-3 tracking-wider flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Pending for KOT ({pendingItems.length} items)
              </h3>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="space-y-1">
                  {pendingItems.map(item => (
                    <div key={item.id} className="flex justify-between text-[11px] py-1 border-b border-amber-100 last:border-0">
                      <span className="font-semibold text-amber-900">
                        {item.product.name}
                        {item.notes && <span className="text-[9px] text-amber-700 italic ml-1">📝 {item.notes}</span>}
                      </span>
                      <span className="font-medium text-amber-800">x{item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* KOT Preview Section — exact copy of the printed kitchen ticket (ThermalKOT) */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center">
            <h3 className="text-[10px] font-bold uppercase text-gray-500 mb-3">KOT Preview</h3>
            <div className="flex justify-center">
              <ThermalKOT
                order={order}
                kot={{
                  kotNumber: nextKotNumber,
                  type: kotRecords.length > 0 ? 'Additional' : 'Original',
                  printedAt: new Date().toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  printedBy: currentEmployee?.name || 'Staff',
                  items: pendingItems.length > 0 ? pendingItems : cartItems,
                }}
                settings={settings}
                className="bg-white border border-dashed border-gray-300 p-4 shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

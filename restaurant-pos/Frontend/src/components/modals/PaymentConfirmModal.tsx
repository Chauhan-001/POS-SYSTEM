/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Payment Confirm Modal — shows cart summary and lets user confirm or go back.
 */

import { ShoppingCart, ArrowLeft, CheckCircle, X, User, Tag, ClipboardCheck, RefreshCw } from 'lucide-react';
import type { SystemSettings } from '../../types';

interface PaymentConfirmModalProps {
  isOpen: boolean;
  cartItems: any[];
  activeOrder: any;
  currentEmployee: any;
  settings: SystemSettings;
  orderType: string;
  paymentMethod: string;
  searchedCustomer: any;
  appliedReward: any;
  appliedOffer?: any;
  splitDetails: { cashAmount: number; cardAmount: number; upiAmount: number; walletAmount: number };
  onClose: () => void;
  onConfirmPayment: () => void;
  onBackToOrders: () => void;
  isProcessing?: boolean;
  /**
   * Totals computed by the billing hook (per-item gstPercent). When provided,
   * the modal shows EXACTLY the numbers that will be billed — the previous
   * flat defaultTaxRate re-computation could diverge from the actual bill.
   */
  totals?: { subtotal: number; discount: number; gst: number; grandTotal: number };
}

export default function PaymentConfirmModal({
  isOpen,
  cartItems,
  activeOrder,
  currentEmployee,
  settings,
  orderType,
  paymentMethod,
  searchedCustomer,
  appliedReward,
  appliedOffer,
  splitDetails,
  onClose,
  onConfirmPayment,
  onBackToOrders,
  isProcessing,
  totals,
}: PaymentConfirmModalProps) {
  if (!isOpen) return null;

  const currencySymbol = settings.currencySymbol;

  // Backward-compatible: use the billing hook's authoritative totals when given;
  // otherwise fall back to the legacy flat-tax re-computation.
  const subtotal = totals?.subtotal ?? cartItems.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 0), 0);
  const discount = totals?.discount ?? (() => {
    let d = 0;
    if (appliedReward) {
      if (appliedReward.type === 'percentage') d = (subtotal * appliedReward.value) / 100;
      else d = appliedReward.value;
    }
    return d;
  })();
  const gst = totals?.gst ?? ((subtotal - discount) * (settings.defaultTaxRate || 5)) / 100;
  const grandTotal = totals?.grandTotal ?? Math.max(0, subtotal - discount + gst);

  const totalItems = cartItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);

  const getPaymentIcon = () => {
    switch (paymentMethod) {
      case 'Cash': return '💵';
      case 'UPI': return '📱';
      case 'Card': return '💳';
      case 'Wallet': return '👛';
      case 'Split': return '🔀';
      default: return '💳';
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 border border-[#e1e2ed] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-gradient-to-r from-[#f0f4ff] to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#191b23]">Confirm Payment</h3>
              {activeOrder && (
                <p className="text-[10px] text-gray-500">Order #{activeOrder.orderNumber}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Order Info Badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-semibold border border-blue-200">
              <ShoppingCart className="w-3 h-3" />
              {totalItems} item{totalItems !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full text-[10px] font-semibold border border-purple-200">
              {getPaymentIcon()} {paymentMethod}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-semibold border border-amber-200">
              <Tag className="w-3 h-3" />
              {orderType}
            </span>
            {searchedCustomer && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-semibold border border-green-200">
                <User className="w-3 h-3" />
                {searchedCustomer.name}
              </span>
            )}
          </div>

          {/* Cart Items Summary */}
          <div className="bg-gray-50 rounded-lg border border-[#e1e2ed] divide-y divide-[#e1e2ed] max-h-48 overflow-y-auto">
            {cartItems.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No items in cart</p>
            ) : (
              cartItems.map((item: any, idx: number) => {
                const lineTotal = (item.price || 0) * (item.quantity || 0);
                return (
                  <div key={item.id || idx} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-gray-400 bg-white border border-[#e1e2ed] rounded w-5 h-5 flex items-center justify-center shrink-0">
                        {item.quantity || 1}x
                      </span>
                      <span className="text-xs font-medium text-[#191b23] truncate">
                        {item.product?.name || item.name || 'Item'}
                      </span>
                      {item.isFree && (
                        <span className="text-[9px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded">FREE</span>
                      )}
                    </div>
                    <span className="text-xs font-mono font-semibold text-[#191b23] shrink-0 ml-2">
                      {currencySymbol}{lineTotal.toFixed(2)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Totals */}
          <div className="bg-white rounded-lg border border-[#e1e2ed] p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-mono font-medium">{currencySymbol}{subtotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-green-600 flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Discount
                  {appliedReward ? ` (${appliedReward.title})` : ''}
                  {appliedOffer?.offer?.title ? ` (${appliedOffer.offer.title}${appliedOffer.offer.couponCode ? ` · ${appliedOffer.offer.couponCode}` : ''})` : ''}
                </span>
                <span className="font-mono font-medium text-green-600">-{currencySymbol}{discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">{totals ? 'GST' : `GST (${settings.defaultTaxRate || 5}%)`}</span>
              <span className="font-mono font-medium">{currencySymbol}{gst.toFixed(2)}</span>
            </div>
            {paymentMethod === 'Split' && (
              <div className="pt-1.5 border-t border-dashed border-[#e1e2ed] space-y-1">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Split Breakdown</p>
                {splitDetails.cashAmount > 0 && (
                  <div className="flex justify-between text-[10px]"><span className="text-gray-500">Cash</span><span className="font-mono">{currencySymbol}{splitDetails.cashAmount.toFixed(2)}</span></div>
                )}
                {splitDetails.cardAmount > 0 && (
                  <div className="flex justify-between text-[10px]"><span className="text-gray-500">Card</span><span className="font-mono">{currencySymbol}{splitDetails.cardAmount.toFixed(2)}</span></div>
                )}
                {splitDetails.upiAmount > 0 && (
                  <div className="flex justify-between text-[10px]"><span className="text-gray-500">UPI</span><span className="font-mono">{currencySymbol}{splitDetails.upiAmount.toFixed(2)}</span></div>
                )}
                {splitDetails.walletAmount > 0 && (
                  <div className="flex justify-between text-[10px]"><span className="text-gray-500">Wallet</span><span className="font-mono">{currencySymbol}{splitDetails.walletAmount.toFixed(2)}</span></div>
                )}
              </div>
            )}
            <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#e1e2ed]">
              <span className="text-[#191b23]">Grand Total</span>
              <span className="font-mono text-[var(--brand-color)]">{currencySymbol}{grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Cashier Info */}
          {currentEmployee && (
            <div className="flex items-center gap-2 text-[10px] text-gray-400 bg-gray-50 rounded-lg p-2 border border-[#e1e2ed]">
              <User className="w-3 h-3" />
              <span>Cashier: <strong className="text-gray-600">{currentEmployee.name}</strong></span>
              <span className="ml-auto">{currentEmployee.role || 'Staff'}</span>
            </div>
          )}
        </div>

        {/* Footer Action Buttons */}
        <div className="p-4 border-t border-[#e1e2ed] flex gap-3 bg-gray-50/50">
          <button
            onClick={onBackToOrders}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white hover:text-[#191b23] transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Orders
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 hover:bg-white hover:text-[#191b23] transition-all cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            onClick={onConfirmPayment}
            disabled={isProcessing}
            data-tour="pay-print-btn"
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ml-auto cursor-pointer ${isProcessing ? 'bg-gray-400 text-gray-200 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-md'}`}
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Close Bill {currencySymbol}{grandTotal.toFixed(2)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

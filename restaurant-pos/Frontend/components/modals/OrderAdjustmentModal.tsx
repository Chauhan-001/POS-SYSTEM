/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderAdjustmentModal — the POS unavailable-item workflow for online orders.
 * When a submitted order contains something the kitchen can't prepare:
 *   - Remove & refund (amount auto-derived from the line snapshot)
 *   - Replace with another product (delta shown: refund or additional due)
 *   - Cancel the entire order (full refund)
 *   - Optionally mark the item unavailable for NEW online orders
 *
 * The backend is authoritative: every amount is computed server-side from the
 * actual order lines; the manager PIN is required when a ledger refund fires.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Phone, X, Ban, RefreshCw, UserX } from 'lucide-react';
import * as api from '../../src/api/client';
import type { Order, Product } from '../../src/types';

interface OrderAdjustmentModalProps {
  order: Order;
  products: Product[];
  currencySymbol: string;
  role?: string;
  onClose: () => void;
  onAdjusted: (result: any) => void;
}

type Action = 'REMOVE' | 'REPLACE' | 'CANCEL';

interface ItemSelection {
  action: Action;
  orderItemId: string;
  productId?: string;
  productName: string;
  quantity: number;
  price: number;
  replaceWithProductId?: string;
}

export default function OrderAdjustmentModal({
  order,
  products,
  currencySymbol,
  role,
  onClose,
  onAdjusted,
}: OrderAdjustmentModalProps) {
  const [selection, setSelection] = useState<ItemSelection | null>(null);
  const [reason, setReason] = useState('');
  const [markUnavailable, setMarkUnavailable] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const isOnline = order.platform === 'Website' || order.type === 'Website' || order.platform === 'Phone' || order.type === 'Delivery';
  const canManage = role === 'Owner' || role === 'Manager';

  const lineTotal = useMemo(() => (sel: ItemSelection) => sel.price * sel.quantity, []);
  const refundEstimate = useMemo(() => {
    if (!selection) return 0;
    if (selection.action === 'CANCEL') return order.grandTotal || 0;
    if (selection.action === 'REMOVE') return lineTotal(selection);
    // REPLACE: removed − replacement price (server recomputes exactly)
    const repl = selection.replaceWithProductId
      ? products.find((p) => p.id === selection.replaceWithProductId)
      : undefined;
    const added = repl ? repl.price * selection.quantity : 0;
    return Math.max(0, lineTotal(selection) - added);
  }, [selection, products, order.grandTotal, lineTotal]);

  const additionalEstimate = useMemo(() => {
    if (!selection || selection.action !== 'REPLACE' || !selection.replaceWithProductId) return 0;
    const repl = products.find((p) => p.id === selection.replaceWithProductId);
    if (!repl) return 0;
    return Math.max(0, repl.price * selection.quantity - lineTotal(selection));
  }, [selection, products, lineTotal]);

  function startAction(action: Action, item?: Order['items'][number]) {
    if (!item) {
      setSelection({ action, orderItemId: '', productName: 'All items', quantity: 1, price: 0 });
      return;
    }
    setSelection({
      action,
      orderItemId: String((item as any).orderItemId || (item as any).id || ''),
      productId: item.product?.id,
      productName: item.product?.name || 'Item',
      quantity: item.quantity || 1,
      price: item.price || 0,
    });
    setReason('');
    setError('');
    setResult(null);
  }

  async function submit() {
    if (!selection) return;
    if (!reason.trim()) {
      setError('Please enter a reason for the adjustment.');
      return;
    }
    if (refundEstimate > 0 && !managerPin.trim()) {
      setError('A manager PIN is required to process this refund.');
      return;
    }
    setLoading(true);
    setError('');

    const payload: any = {
      adjustmentId: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action: selection.action,
      reason: reason.trim(),
      markUnavailable,
    };
    if (selection.action !== 'CANCEL') {
      const items: any[] = [{
        orderItemId: selection.orderItemId || undefined,
        productId: selection.productId || undefined,
        quantity: selection.quantity,
      }];
      if (selection.action === 'REPLACE' && selection.replaceWithProductId) {
        items[0].replaceWithProductId = selection.replaceWithProductId;
      }
      payload.items = items;
    }
    if (managerPin) payload.managerPin = managerPin;

    const res = await api.adjustOrder(order.id, payload);
    setLoading(false);
    if (!res) {
      setError('Could not reach the server. Please try again.');
      return;
    }
    setResult(res);
  }

  if (result) {
    const adj = result.adjustment;
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-[#e1e2ed] p-6">
          <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-center mb-1">Order adjusted</h3>
          <p className="text-xs text-gray-500 text-center mb-4">#{order.orderNumber} · {adj.action}</p>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">Original total</span>
              <span className="font-semibold">{currencySymbol}{(adj.originalTotal ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">New total</span>
              <span className="font-bold">{currencySymbol}{(adj.newTotal ?? 0).toFixed(2)}</span>
            </div>
            {adj.refundRequired > 0 && (
              <div className="flex justify-between px-3 py-2 bg-red-50 rounded-lg text-red-700">
                <span className="text-xs font-semibold">Refund</span>
                <span className="font-bold">{currencySymbol}{(adj.refundRequired ?? 0).toFixed(2)}</span>
              </div>
            )}
            {adj.additionalDue > 0 && (
              <div className="flex justify-between px-3 py-2 bg-amber-50 rounded-lg text-amber-700">
                <span className="text-xs font-semibold">Additional due (authorize)</span>
                <span className="font-bold">{currencySymbol}{(adj.additionalDue ?? 0).toFixed(2)}</span>
              </div>
            )}
          </div>

          {result.refundPendingReason && (
            <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-[11px]">
              ⚠ {result.refundPendingReason}
            </p>
          )}
          {result.refund?.status && (
            <p className="mt-3 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
              Refund {result.refund.status.toLowerCase()}
              {result.refund.providerRefundId ? ` · ${result.refund.providerRefundId}` : ''}
            </p>
          )}

          <button
            onClick={() => { onAdjusted(result); onClose(); }}
            className="mt-5 w-full py-2.5 rounded-xl bg-[var(--brand-color)] text-white text-sm font-bold hover:opacity-90 transition-all cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-[#e1e2ed] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e1e2ed] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-[#191b23]">Item unavailable</h3>
            <p className="text-[11px] text-gray-500">Order #{order.orderNumber} · {order.platform || order.type}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {/* Customer contact */}
          {order.customerName || order.customerPhone ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100 mb-4">
              <UserX className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-blue-800 flex-1">
                {order.customerName || 'Customer'}
                {order.customerPhone ? ` · ${order.customerPhone}` : ''}
              </span>
              {order.customerPhone && (
                <a
                  href={`tel:${order.customerPhone}`}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 transition-all"
                >
                  <Phone className="w-3 h-3" /> Call
                </a>
              )}
            </div>
          ) : null}

          {!canManage ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Only the Owner or Manager can adjust an order.
            </p>
          ) : !selection ? (
            <>
              <p className="text-xs text-gray-500 mb-3">Which item can't be prepared?</p>
              <div className="space-y-2">
                {order.items?.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => startAction('REMOVE', item)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#e1e2ed] hover:border-red-200 hover:bg-red-50/40 transition-all cursor-pointer text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#191b23] truncate">
                        {item.product?.name || 'Item'}
                      </p>
                      <p className="text-[10px] text-gray-400">× {item.quantity}</p>
                    </div>
                    <span className="text-xs font-semibold text-gray-600">
                      {currencySymbol}{((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                    </span>
                  </button>
                ))}
                <div className="pt-2 border-t border-[#e1e2ed]">
                  <button
                    onClick={() => startAction('CANCEL')}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 transition-all cursor-pointer"
                  >
                    <Ban className="w-4 h-4" /> Cancel entire order
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Selected item summary */}
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 border border-[#e1e2ed] mb-4">
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#191b23]">{selection.productName}</p>
                  <p className="text-[10px] text-gray-400">× {selection.quantity} · {currencySymbol}{(selection.price * selection.quantity).toFixed(2)}</p>
                </div>
                <button onClick={() => setSelection(null)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer">
                  Change
                </button>
              </div>

              {/* Action choice */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setSelection({ ...selection, action: 'REMOVE' })}
                  className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                    selection.action === 'REMOVE'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-gray-600 border-[#e1e2ed] hover:border-red-300'
                  }`}
                >
                  Remove & refund
                </button>
                <button
                  onClick={() => setSelection({ ...selection, action: 'REPLACE' })}
                  className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                    selection.action === 'REPLACE'
                      ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]'
                      : 'bg-white text-gray-600 border-[#e1e2ed] hover:border-blue-300'
                  }`}
                >
                  Replace item
                </button>
              </div>

              {selection.action === 'REPLACE' && (
                <div className="mb-4">
                  <label className="text-[10px] font-bold text-gray-500 mb-1 block">Replace with</label>
                  <select
                    value={selection.replaceWithProductId || ''}
                    onChange={(e) => setSelection({ ...selection, replaceWithProductId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#e1e2ed] text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Select a product…</option>
                    {products
                      .filter((p) => p.id !== selection.productId)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {currencySymbol}{p.price.toFixed(2)}
                        </option>
                      ))}
                  </select>
                  {selection.replaceWithProductId && (
                    <div className={`mt-2 px-3 py-2 rounded-xl text-[11px] font-semibold ${
                      additionalEstimate > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {additionalEstimate > 0
                        ? `Customer must authorize an extra ${currencySymbol}${additionalEstimate.toFixed(2)}`
                        : `Refund difference ≈ ${currencySymbol}${refundEstimate.toFixed(2)} (server-confirmed on save)`}
                    </div>
                  )}
                </div>
              )}

              {isOnline && (
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-[#e1e2ed] mb-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={markUnavailable}
                    onChange={(e) => setMarkUnavailable(e.target.checked)}
                    className="accent-[var(--brand-color)]"
                  />
                  <span className="text-[11px] font-semibold text-gray-700">
                    Also block {selection.productName} for new online orders
                  </span>
                </label>
              )}

              <label className="text-[10px] font-bold text-gray-500 mb-1 block">Reason</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={selection.action === 'CANCEL' ? 'Why is the whole order cancelled?' : 'e.g. Sold out in kitchen'}
                className="w-full px-3 py-2 rounded-xl border border-[#e1e2ed] text-xs mb-3 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />

              {refundEstimate > 0 && (
                <label className="text-[10px] font-bold text-gray-500 mb-1 block">Manager PIN (required for refund)</label>
              )}
              <input
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                type="password"
                placeholder={refundEstimate > 0 ? 'Enter manager PIN to authorize refund' : 'Manager PIN (optional)'}
                className="w-full px-3 py-2 rounded-xl border border-[#e1e2ed] text-xs mb-4 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />

              {error && (
                <p className="mb-3 px-3 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 text-[11px]">{error}</p>
              )}

              {/* Summary */}
              <div className="px-3 py-2.5 rounded-xl bg-gray-50 border border-[#e1e2ed] mb-4 text-[11px] space-y-1">
                {selection.action === 'CANCEL' && (
                  <div className="flex justify-between"><span className="text-gray-500">Full refund</span><span className="font-bold text-red-600">{currencySymbol}{(order.grandTotal || 0).toFixed(2)}</span></div>
                )}
                {selection.action === 'REMOVE' && (
                  <div className="flex justify-between"><span className="text-gray-500">Refund</span><span className="font-bold text-red-600">{currencySymbol}{refundEstimate.toFixed(2)}</span></div>
                )}
                {selection.action === 'REPLACE' && (
                  <>
                    {additionalEstimate > 0
                      ? <div className="flex justify-between"><span className="text-gray-500">Additional due</span><span className="font-bold text-amber-600">{currencySymbol}{additionalEstimate.toFixed(2)}</span></div>
                      : <div className="flex justify-between"><span className="text-gray-500">Refund difference</span><span className="font-bold text-red-600">{currencySymbol}{refundEstimate.toFixed(2)}</span></div>}
                  </>
                )}
              </div>

              <button
                onClick={submit}
                disabled={loading || (selection.action === 'REPLACE' && !selection.replaceWithProductId)}
                className="w-full py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {selection.action === 'CANCEL' ? 'Cancel & refund order' : 'Apply adjustment'}
              </button>
              <p className="text-[9px] text-gray-400 text-center mt-2">
                All amounts are recalculated by the server from the actual order lines. Refunds are audited and idempotent.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

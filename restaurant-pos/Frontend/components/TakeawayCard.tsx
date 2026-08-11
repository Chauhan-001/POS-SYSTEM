/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Memoized takeaway order card for OrderManager.
 */

import React from 'react';
import { User, Package, Timer } from 'lucide-react';
import type { TakeawayOrder, Order } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';
import { computeRunningBillTotals } from '../src/utils/runningBill';

interface TakeawayCardProps {
  order: TakeawayOrder;
  orders: Order[];
  currencySymbol: string;
  onOpenBilling: (order: Order) => void;
  onUpdateTakeawayOrder: (id: string, updates: Partial<TakeawayOrder>) => void;
  showToast: (message: string, type: 'success' | 'info' | 'warning') => void;
  getElapsedTime: (createdAt: string, now?: Date) => string;
}

function TakeawayCard({
  order, orders, currencySymbol,
  onOpenBilling, onUpdateTakeawayOrder, showToast, getElapsedTime,
}: TakeawayCardProps) {
  const now = useCurrentTime();
  const statusColor = order.status === 'Ready' ? 'bg-green-100 text-green-800 border-green-200'
    : order.status === 'Preparing' ? 'bg-amber-100 text-amber-800 border-amber-200'
    : order.status === 'Collected' ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-gray-100 text-gray-600 border-gray-200';
  
  const createdTime = new Date(order.createdAt).getTime();
  const elapsedMin = (now.getTime() - createdTime) / 60000;
  const isOverdue = elapsedMin > 30 && order.status !== 'Collected' && order.status !== 'Completed';
  // Live running bill from the order's current items (mirrors checkout math)
  const runningBill = computeRunningBillTotals(order.items || []).grandTotal;

  return (
    <div
      onClick={() => {
        // Resolve the linked Order by id first (the live link set on create).
        // Fall back to matching by orderNumber: legacy rows whose orderId still
        // points at the takeaway-orders doc id (pre-fix rows) or was clobbered
        // to null by a server merge before the link push landed share the same
        // order number series as their Order, so the match is unambiguous.
        const fullOrder =
          orders.find(o => o.id === order.orderId) ||
          orders.find(o => o.orderNumber === order.orderNumber);
        if (fullOrder) onOpenBilling(fullOrder);
        else showToast(`Order #${order.orderNumber} not found — pull to sync`, 'warning');
      }}
      className={`rounded-xl border-2 transition-all duration-200 cursor-pointer p-4 ${
        isOverdue
          ? 'bg-red-50 border-red-400 hover:shadow-lg hover:-translate-y-0.5 animate-pulse'
          : 'bg-white border-gray-200 hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="font-bold text-sm text-gray-900">#{order.orderNumber}</span>
          <span className={`ml-2 px-2 py-0.5 rounded-full text-[9px] font-bold ${statusColor}`}>
            {order.status}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
          <Timer className="w-3 h-3 text-gray-400" />
          {getElapsedTime(order.createdAt, now)}
        </span>
      </div>

      <div className="space-y-1 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-700">
          <User className="w-3 h-3 text-gray-400" />
          <span className="font-semibold">{order.customerName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Package className="w-3 h-3 text-gray-400" />
          <span>{order.items.length} item(s)</span>
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold text-sm">
            {currencySymbol}{(runningBill > 0 ? runningBill : order.amount).toFixed(2)}
          </span>
          {runningBill > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-bold">
              RUNNING
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(order.status === 'Ready' || order.status === 'Completed') && (
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateTakeawayOrder(order.id, { status: 'Collected' as const }); showToast(`Order #${order.orderNumber} marked as collected`, 'success'); }}
              className="text-[9px] font-bold px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              Collected
            </button>
          )}
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
            order.paymentStatus === 'Paid' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-amber-100 text-amber-700'
          }`}>
            {order.paymentStatus}
          </span>
        </div>
      </div>
    </div>
  );
}

export default React.memo(TakeawayCard);

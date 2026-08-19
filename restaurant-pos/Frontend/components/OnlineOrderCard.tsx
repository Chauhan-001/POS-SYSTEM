/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Memoized online order card for OrderManager.
 */

import React from 'react';
import { User, Clock, Bike, AlertTriangle } from 'lucide-react';
import type { Order } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';
import { computeRunningBillTotals } from '../src/utils/runningBill';

interface OnlineOrderCardProps {
  order: Order;
  currencySymbol: string;
  STATUS_COLORS: Record<string, string>;
  onOpenBilling: (order: Order) => void;
  getElapsedTime: (createdAt: string, now?: Date) => string;
  /** When set, renders an "Item unavailable" action on the card. */
  onAdjustOrder?: (order: Order) => void;
  /** Whether the order already has adjustments (shows a small marker). */
  hasAdjustments?: boolean;
}

const platformColors: Record<string, string> = {
  'Swiggy': 'bg-orange-100 text-orange-800 border-orange-200',
  'Zomato': 'bg-red-100 text-red-800 border-red-200',
  'Uber Eats': 'bg-blue-100 text-blue-800 border-blue-200',
  'Website': 'bg-purple-100 text-purple-800 border-purple-200',
  'Phone': 'bg-gray-100 text-gray-800 border-gray-200',
};

function OnlineOrderCard({
  order, currencySymbol, STATUS_COLORS,
  onOpenBilling, getElapsedTime, onAdjustOrder, hasAdjustments,
}: OnlineOrderCardProps) {
  const now = useCurrentTime();
  const platformColor = platformColors[order.platform || ''] || 'bg-gray-100 text-gray-700';
  // Live running bill from the order's current items (mirrors checkout math)
  const runningBill = computeRunningBillTotals(order.items || []).grandTotal;

  return (
    <div
      onClick={() => onOpenBilling(order)}
      className="bg-[var(--color-bg-white)] rounded-xl border border-gray-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer p-4"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${platformColor}`}>
            {order.platform || order.type}
          </span>
          <span className="font-bold text-sm text-gray-900">#{order.orderNumber}</span>
          {hasAdjustments && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold">
              ADJUSTED
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onAdjustOrder && (
            <button
              onClick={(e) => { e.stopPropagation(); onAdjustOrder(order); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-600 border border-red-200 text-[9px] font-bold hover:bg-red-100 transition-all cursor-pointer"
              title="Mark an item unavailable / adjust this order"
            >
              <AlertTriangle className="w-3 h-3" />
              Item unavailable
            </button>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
            {order.status}
          </span>
        </div>
      </div>

      <div className="space-y-1 mb-2">
        {order.customerName && (
          <div className="flex items-center gap-1.5 text-[11px] text-gray-700">
            <User className="w-3 h-3 text-gray-400" />
            <span className="font-semibold">{order.customerName}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Clock className="w-3 h-3 text-gray-400" />
          <span className="font-mono">{getElapsedTime(order.createdAt, now)}</span>
        </div>
        {(order.mode === 'CAR' || order.parkingSlot || order.carPlate) && (
          <div className="flex items-center gap-1.5 text-[10px] text-teal-700">
            <span className="font-semibold">
              🚗 {order.parkingSlot ? `Slot ${order.parkingSlot}` : 'Car'}
              {order.carPlate ? ` · ${order.carPlate}` : ''}
            </span>
          </div>
        )}
        {order.deliveryEta && (
          <div className="flex items-center gap-1.5 text-[10px] text-blue-600">
            <Bike className="w-3 h-3" />
            <span className="font-semibold">ETA: {order.deliveryEta}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold text-sm">
            {currencySymbol}{(runningBill > 0 ? runningBill : order.grandTotal).toFixed(2)}
          </span>
          {runningBill > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-bold">
              RUNNING
            </span>
          )}
        </div>
        {order.deliveryAddress && (
          <span className="text-[8px] text-gray-400 truncate max-w-[120px]">
            📍 {order.deliveryAddress}
          </span>
        )}
      </div>
    </div>
  );
}

export default React.memo(OnlineOrderCard);

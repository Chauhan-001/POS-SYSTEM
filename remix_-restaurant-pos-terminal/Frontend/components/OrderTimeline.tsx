/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Clock, FileText, Printer, ShoppingCart, Trash2, RefreshCw,
  CreditCard, CheckCircle, XCircle, PauseCircle, PlayCircle,
  User, Tag, Percent, ArrowRight, Ban
} from 'lucide-react';
import { TimelineEvent, TimelineEventType } from '../src/types';

interface OrderTimelineProps {
  events: TimelineEvent[];
  isOpen: boolean;
  onClose: () => void;
}

const EVENT_CONFIG: Record<TimelineEventType, { icon: React.ElementType; label: string; color: string }> = {
  'order_created': { icon: FileText, label: 'Order Created', color: 'text-blue-600 bg-blue-100' },
  'kot_printed': { icon: Printer, label: 'KOT Printed', color: 'text-amber-600 bg-amber-100' },
  'item_added': { icon: ShoppingCart, label: 'Item Added', color: 'text-emerald-600 bg-emerald-100' },
  'item_removed': { icon: Trash2, label: 'Item Removed', color: 'text-red-600 bg-red-100' },
  'kot_additional_printed': { icon: Printer, label: 'Additional KOT Printed', color: 'text-orange-600 bg-orange-100' },
  'kot_reprint': { icon: RefreshCw, label: 'KOT Reprint', color: 'text-red-600 bg-red-100' },
  'interim_bill_printed': { icon: FileText, label: 'Interim Bill Printed', color: 'text-purple-600 bg-purple-100' },
  'payment_completed': { icon: CreditCard, label: 'Payment Completed', color: 'text-emerald-600 bg-emerald-100' },
  'final_bill_printed': { icon: FileText, label: 'Final Bill Printed', color: 'text-blue-600 bg-blue-100' },
  'order_closed': { icon: CheckCircle, label: 'Order Closed', color: 'text-gray-600 bg-gray-100' },
  'order_held': { icon: PauseCircle, label: 'Order Held', color: 'text-slate-600 bg-slate-100' },
  'order_resumed': { icon: PlayCircle, label: 'Order Resumed', color: 'text-emerald-600 bg-emerald-100' },
  'order_transferred': { icon: ArrowRight, label: 'Order Transferred', color: 'text-indigo-600 bg-indigo-100' },
  'order_merged': { icon: ArrowRight, label: 'Order Merged', color: 'text-violet-600 bg-violet-100' },
  'order_split': { icon: ArrowRight, label: 'Order Split', color: 'text-pink-600 bg-pink-100' },
  'discount_applied': { icon: Percent, label: 'Discount Applied', color: 'text-teal-600 bg-teal-100' },
  'customer_assigned': { icon: User, label: 'Customer Assigned', color: 'text-blue-600 bg-blue-100' },
  'waiter_assigned': { icon: User, label: 'Waiter Assigned', color: 'text-cyan-600 bg-cyan-100' },
  'order_cancelled': { icon: XCircle, label: 'Order Cancelled', color: 'text-red-600 bg-red-100' },
  'order_refunded': { icon: Ban, label: 'Order Refunded', color: 'text-purple-600 bg-purple-100' },
};

export default function OrderTimeline({ events, isOpen, onClose }: OrderTimelineProps) {
  if (!isOpen) return null;

  const sortedEvents = [...events].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-700" />
            <h2 className="font-bold text-sm text-gray-900">Order Timeline</h2>
            <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full">
              {events.length} events
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-5">
          {sortedEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Clock className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="font-semibold text-gray-500">No events recorded</p>
              <p className="text-xs mt-1">The order timeline will populate as actions are performed</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200" />

              <div className="space-y-0">
                {sortedEvents.map((event, index) => {
                  const config = EVENT_CONFIG[event.type] || { icon: Clock, label: event.type, color: 'text-gray-600 bg-gray-100' };
                  const IconComp = config.icon;
                  const isFirst = index === 0;

                  return (
                    <div key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
                      {/* Timeline dot */}
                      <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${config.color}`}>
                        <IconComp className="w-4 h-4" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[11px] text-gray-900">{config.label}</span>
                          <span className="text-[9px] text-gray-400 font-mono shrink-0">
                            {formatTimestamp(event.timestamp)}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-0.5">{event.description}</p>
                        {event.actor && (
                          <span className="text-[9px] text-gray-400 mt-0.5 block">by {event.actor}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
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

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return timestamp;
  }
}

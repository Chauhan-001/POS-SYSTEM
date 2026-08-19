/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Memoized table card for OrderManager.
 * Extracted to prevent re-rendering all table cards when unrelated data changes.
 */

import React from 'react';
import {
  Clock, AlertCircle, CheckCircle, Timer, Receipt, Users, Wifi, ChevronRight, LayoutGrid,
  Ban, XCircle, CalendarClock, Sparkles, Hourglass, StopCircle,
} from 'lucide-react';
import type { TableInfo, Order } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';

interface TableCardProps {
  table: TableInfo;
  order: Order | undefined;
  bill: number;
  currencySymbol: string;
  sectionColors: Record<string, string>;
  TABLE_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }>;
  onOpenReceiptPreview: (order: Order) => void;
  onOpenBilling: (order: Order) => void;
  onCreateOrder: (type: Order['type'], tableId?: string) => void;
  /** Open an AVAILABLE table's billing workspace without creating an order. */
  onOpenTableBilling: (tableId: string) => void;
  /** End a customer's ACTIVE table-QR seat session (the QR stays valid). */
  onExpireSession?: (tableId: string) => void;
  getElapsedTime: (createdAt: string, now?: Date) => string;
}

function getStatusColor(status: string, colors: Record<string, { bg: string; text: string; dot: string }>) {
  return colors[status] || colors['Available'];
}

/** Small status icon per table status (falls back to a clock). */
const STATUS_ICONS: Record<string, React.ElementType> = {
  'Available': CheckCircle,
  'Occupied': Users,
  'Reserved': CalendarClock,
  'Preparing': Timer,
  'Food Ready': CheckCircle,
  'Served': CheckCircle,
  'Waiting Payment': Clock,
  'Cleaning': Sparkles,
  'Paid': CheckCircle,
  'Cancelled': XCircle,
  'Disabled': Ban,
  'Merged': Users,
};

function TableCard({
  table, order, bill, currencySymbol, sectionColors,
  TABLE_STATUS_COLORS,
  onOpenReceiptPreview, onOpenBilling, onCreateOrder, onOpenTableBilling, onExpireSession, getElapsedTime,
}: TableCardProps) {
  const statusStyle = getStatusColor(table.status, TABLE_STATUS_COLORS);
  const sc = table.section ? (sectionColors[table.section] || 'bg-gray-100 text-gray-700 border-gray-200') : '';
  const StatusIcon = STATUS_ICONS[table.status] || Clock;
  const isAvailable = table.status === 'Available';
  const hasOrder = table.status !== 'Available' && !!order;
  // A table held by a customer's QR scan (no order yet) — the cashier can
  // end the session; the QR itself stays valid forever.
  const isScanHeld = table.status !== 'Available' && !hasOrder && !!table.activeSession;
  // Live clock — re-renders this card every second so the occupancy timer ticks.
  const now = useCurrentTime();
  const sessionMinsLeft = table.activeSession?.expiresAt
    ? Math.max(0, Math.ceil((new Date(table.activeSession.expiresAt).getTime() - now.getTime()) / 60000))
    : 0;

  return (
    <div
      className={`relative rounded-[20px] border bg-[var(--color-bg-white)] p-3.5 sm:p-4 shadow-sm transition-all duration-150 group flex flex-col
        ${isAvailable
          ? 'border-[var(--color-border-default)] hover:border-emerald-300 hover:shadow-md hover:-translate-y-0.5'
          : 'border-[var(--color-border-default)] hover:border-[#0047AB]/25 hover:shadow-md hover:-translate-y-0.5'
        }
        ${table.priority === 'urgent' ? 'ring-2 ring-red-400 ring-offset-1' : ''}
        ${table.priority === 'high' ? 'ring-2 ring-amber-400 ring-offset-1' : ''}
      `}
      data-tour="table-card"
    >
      {/* Priority indicator */}
      {table.priority === 'urgent' && (
        <span className="absolute -top-2.5 right-4 bg-[var(--color-red-500-solid)] text-white text-[9px] font-bold px-2.5 py-1 rounded-full z-10 animate-pulse shadow-md flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          URGENT
        </span>
      )}

      {/* Click handler on card body */}
      <div onClick={() => {
        if (table.status === 'Available') {
          // Open billing WITHOUT creating an order — accidental taps must never
          // occupy a table. The order is born on the first KOT.
          onOpenTableBilling(table.id);
        } else if (order) {
          onOpenBilling(order);
        }
      }} className="flex flex-col flex-1">
        {/* ─── TOP ROW: table number + status badge (left) · action cards (right) ─── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-2xl sm:text-3xl font-black leading-none text-[#0D1B2A] tracking-tight">
              T{table.number}
            </span>
            {/* Solid color-coded status badge — occupied shows the live timer instead of the word */}
            <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full ${statusStyle.dot} text-white shadow-sm whitespace-nowrap`}>
              <StatusIcon className="w-3 h-3 shrink-0 text-white" />
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                {table.status === 'Occupied' && (table.orderSince || table.occupiedSince)
                  ? getElapsedTime(table.orderSince || table.occupiedSince || '', now)
                  : table.status}
              </span>
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/70 ml-0.5" />
            </span>
          </div>

          {/* Top-right rectangular action card (occupied tables with an order) */}
          {hasOrder && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenReceiptPreview(order); }}
                className="w-8 h-10 sm:w-10 sm:h-11 rounded-lg bg-[var(--color-bg-white)] border border-[var(--color-border-default)] border-t-2 border-t-[#FF8C1A] hover:shadow-md hover:-translate-y-0.5 active:scale-95 transition-all duration-150 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                title="View live bill"
                aria-label={`View live bill for table ${table.number}`}
              >
                <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FF8C1A]" />
                <span className="text-[8px] sm:text-[9px] font-bold text-[#1B263B] leading-none">Bill</span>
              </button>
            </div>
          )}
          {/* Top-right action card — table held by a customer's QR scan (same style as occupied) */}
          {isScanHeld && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenTableBilling(table.id); }}
                className="w-8 h-10 sm:w-10 sm:h-11 rounded-lg bg-[var(--color-bg-white)] border border-[var(--color-border-default)] border-t-2 border-t-[#FF8C1A] hover:shadow-md hover:-translate-y-0.5 active:scale-95 transition-all duration-150 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                title="View live bill"
                aria-label={`View live bill for table ${table.number}`}
              >
                <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FF8C1A]" />
                <span className="text-[8px] sm:text-[9px] font-bold text-[#1B263B] leading-none">Bill</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onExpireSession?.(table.id); }}
                className="w-8 h-10 sm:w-10 sm:h-11 rounded-lg bg-[var(--color-bg-white)] border border-[var(--color-border-default)] border-t-2 border-t-red-500 hover:shadow-md hover:-translate-y-0.5 active:scale-95 transition-all duration-150 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                title="End this customer's QR session (the QR stays valid)"
                aria-label={`End QR session for table ${table.number}`}
              >
                <StopCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500" />
                <span className="text-[8px] sm:text-[9px] font-bold text-[#1B263B] leading-none">End</span>
              </button>
            </div>
          )}
        </div>

        {/* ─── LIVE META ROW: cost + kitchen status ─── */}
        {table.status !== 'Available' && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            {bill > 0 && (
              <span className="flex items-center gap-1 text-sm font-black text-[#0D1B2A]">
                {currencySymbol}{bill.toFixed(2)}
              </span>
            )}
            {order && order.status === 'Ready' && (
              <span className="flex items-center gap-1 bg-green-100 text-green-800 text-[8px] font-bold px-2 py-0.5 rounded-full">
                <CheckCircle className="w-2.5 h-2.5" />
                FOOD READY
              </span>
            )}
            {order && order.status === 'Preparing' && (
              <span className="flex items-center gap-1 bg-amber-100 text-amber-800 text-[8px] font-bold px-2 py-0.5 rounded-full">
                <Timer className="w-2.5 h-2.5" />
                PREPARING
              </span>
            )}
          </div>
        )}

        {/* Spacer + divider pushes the CTA to the bottom so all cards align */}
        <div className="flex-1" />

        {/* ─── DIVIDER ─── */}
        <div className="h-px bg-[var(--color-surface-muted)] mt-2.5 mb-2.5" />

        {/* ─── MIDDLE SECTION: window/grid icon + seating info ─── */}
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 ${sc || 'bg-[var(--color-surface-muted)] text-[#4F46E5]'}`}>
            <LayoutGrid className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm sm:text-base font-bold text-[#1B263B] leading-tight truncate">{table.section || 'Dining Area'}</p>
            <p className="text-[11px] sm:text-xs text-[#6C757D] leading-tight truncate">
              {table.capacity ? `${table.capacity} seats · ` : ''}Preferred seating
            </p>
          </div>
          {table.reservationName && (
            <span className="ml-auto shrink-0 flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200/60 text-[9px] font-bold px-2 py-0.5 rounded-lg">
              📋 {table.reservationName}
            </span>
          )}
        </div>

        {/* ─── BOTTOM: outlined primary action ─── */}
        {hasOrder ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenBilling(order); }}
            className="mt-2.5 w-full h-9 sm:h-10 rounded-lg bg-[var(--color-surface-muted)] border border-[#002FA7]/25 text-[#002FA7] hover:bg-[var(--color-surface-muted)] hover:border-[#002FA7]/40 active:scale-[0.98] transition-all duration-150 shadow-sm flex items-center cursor-pointer"
            aria-label={`Open order/billing for table ${table.number}`}
          >
            <span className="w-8 flex items-center justify-center shrink-0"><Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
            <span className="flex-1 text-center text-xs sm:text-[13px] font-bold tracking-tight">Order</span>
            <span className="w-8 flex items-center justify-center shrink-0"><ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
          </button>
        ) : isScanHeld ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTableBilling(table.id); }}
            className="mt-2.5 w-full h-9 sm:h-10 rounded-lg bg-[var(--color-surface-muted)] border border-[#002FA7]/25 text-[#002FA7] hover:bg-[var(--color-surface-muted)] hover:border-[#002FA7]/40 active:scale-[0.98] transition-all duration-150 shadow-sm flex items-center cursor-pointer"
            aria-label={`Open order/billing for table ${table.number}`}
          >
            <span className="w-8 flex items-center justify-center shrink-0"><Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
            <span className="flex-1 text-center text-xs sm:text-[13px] font-bold tracking-tight">Order</span>
            <span className="w-8 flex items-center justify-center shrink-0"><ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
          </button>
        ) : isAvailable ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTableBilling(table.id); }}
            className="mt-2.5 w-full h-9 sm:h-10 rounded-lg bg-[var(--color-surface-muted)] border border-emerald-500/25 text-emerald-700 hover:bg-[var(--color-surface-muted)] hover:border-emerald-500/40 active:scale-[0.98] transition-all duration-150 shadow-sm flex items-center cursor-pointer"
            aria-label={`Open order/billing for table ${table.number}`}
          >
            <span className="w-8 flex items-center justify-center shrink-0"><Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
            <span className="flex-1 text-center text-xs sm:text-[13px] font-bold tracking-tight">Order</span>
            <span className="w-8 flex items-center justify-center shrink-0"><ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default React.memo(TableCard);

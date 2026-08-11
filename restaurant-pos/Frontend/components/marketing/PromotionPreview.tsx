/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionPreview — a polished customer-facing preview of an offer, exactly
 * as a customer would see it (checkout card / WhatsApp / public store).
 */

import React from 'react';
import { OFFER_TYPE_ICONS, offerValueLabel, fmtNumber } from './shared';

interface PromotionPreviewProps {
  draft: any;
  currencySymbol: string;
  audienceSize?: number | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PromotionPreview({ draft, currencySymbol, audienceSize }: PromotionPreviewProps) {
  const title = draft.title?.trim() || `${offerValueLabel(draft.type, draft.value, currencySymbol)} promotion`;
  const scheduleText =
    draft.runMode === 'now'
      ? 'Available now'
      : [
          draft.startDate && `Starts ${draft.startDate}`,
          draft.endDate && `until ${draft.endDate}`,
          draft.repeatWeekly && draft.daysOfWeek.length ? `· ${draft.daysOfWeek.map((d) => DAYS[d]).join(', ')}` : '',
        ].filter(Boolean).join(' ');
  const timeText = draft.repeatWeekly && draft.startHour !== '' && draft.endHour !== ''
    ? `${String(draft.startHour).padStart(2, '0')}:00 – ${String(draft.endHour).padStart(2, '0')}:00`
    : null;

  return (
    <div className="bg-white rounded-3xl border border-[#e1e2ed] shadow-sm overflow-hidden">
      {/* Coupon-style header */}
      <div className="bg-gradient-to-br from-[var(--brand-color)] to-blue-500 text-white px-6 py-5 relative">
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-[radial-gradient(circle_at_left,transparent_14px,#fff_15px)] opacity-90" />
        <p className="text-[9px] font-black uppercase tracking-widest text-blue-100">{title} 🎉</p>
        <p className="text-3xl font-black mt-1 tracking-tight">{offerValueLabel(draft.type, draft.value, currencySymbol)}</p>
        {draft.minOrderValue ? (
          <p className="text-xs font-bold text-blue-100 mt-1">On orders above {currencySymbol}{fmtNumber(draft.minOrderValue)}</p>
        ) : (
          <p className="text-xs font-bold text-blue-100 mt-1">On your next order</p>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="space-y-1.5 text-xs text-gray-700">
          {scheduleText && <p className="flex items-center gap-1.5"><span>🗓️</span> <strong>{scheduleText}</strong></p>}
          {timeText && <p className="flex items-center gap-1.5"><span>⏰</span> <strong>{timeText}</strong></p>}
          {audienceSize ? (
            <p className="flex items-center gap-1.5"><span>👥</span> <strong>~{fmtNumber(audienceSize)} customers eligible</strong></p>
          ) : (
            <p className="flex items-center gap-1.5"><span>👥</span> <strong>All customers</strong></p>
          )}
        </div>

        {draft.couponEnabled && draft.couponCode && (
          <div className="flex items-center justify-between bg-amber-50 border-2 border-dashed border-amber-300 rounded-2xl px-4 py-3">
            <div>
              <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Use code</p>
              <p className="text-xl font-black font-mono tracking-widest text-amber-900">{draft.couponCode}</p>
            </div>
            <span className="text-2xl">{OFFER_TYPE_ICONS.coupon || '🎟️'}</span>
          </div>
        )}

        {draft.description?.trim() && (
          <p className="text-xs text-gray-500 leading-relaxed">{draft.description.trim()}</p>
        )}

        <div className="pt-3 border-t border-dashed border-gray-200 flex items-center justify-between text-[10px] text-gray-400">
          <span>Show this at the counter, or enter the code at checkout.</span>
          <span className="font-bold">No double discounts · one per order</span>
        </div>
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionPreview — customer-facing preview of an offer (wizard step 5).
 *
 * Shows two things:
 *   1. The classic coupon/checkout card (what a customer sees at checkout or
 *      when the offer is applied to a bill).
 *   2. "How it looks on every screen" — the same offer creative rendered on
 *      each placement the platform publishes to (website banner, offer card,
 *      social/WhatsApp, QR ordering). The offer banner image (`draft.imageUrl`)
 *      is applied as the shared image on every screen, mirroring the Promotion
 *      Studio's per-screen overrides: screens without their own image fall
 *      back to the shared one.
 *
 * The creative renderer (PromotionCreative) is reused — the preview and the
 * published creative are the same component, so what the owner approves is
 * exactly what customers see.
 */

import React from 'react';
import PromotionCreative from './PromotionCreative';
import { OFFER_TYPE_ICONS, offerValueLabel, fmtNumber } from './shared';

interface PromotionPreviewProps {
  draft: any;
  currencySymbol: string;
  audienceSize?: number | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Same placements the Promotion Studio publishes to — a screen without its own
// image uses the shared banner, exactly like `creative.screenImages` fallback.
// `width` keeps the exact published aspect ratio per screen (scale=1), so the
// preview geometry matches what customers actually see.
const SCREENS = [
  { id: 'hero-banner', label: 'Website banner', hint: 'Top of your customer website', emoji: '🖥️', width: 'w-full' },
  { id: 'offer-card', label: 'Offer card', hint: 'Compact card next to menu items', emoji: '🃏', width: 'w-56' },
  { id: 'square-creative', label: 'Social / WhatsApp', hint: 'WhatsApp status & social posts', emoji: '📱', width: 'w-44' },
  { id: 'mobile-banner', label: 'QR ordering', hint: 'Top of the QR ordering screen', emoji: '🧾', width: 'w-36' },
] as const;

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

  const discountLabel = offerValueLabel(draft.type, draft.value, currencySymbol);

  // The creative every screen renders from. The banner image (`draft.imageUrl`)
  // is the shared image — the same fallback rule the Promotion Studio uses.
  const creative = {
    title,
    subtitle: draft.minOrderValue ? `On orders above ${currencySymbol}${fmtNumber(draft.minOrderValue)}` : 'On your next order',
    description: draft.description || '',
    cta: 'Order Now',
    language: 'en',
    tone: 'friendly',
    colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
    image: draft.imageUrl ? { key: draft.imageUrl, source: 'offer' } : null,
    logoKey: null,
    productImageKeys: [],
    layout: 'hero-banner',
  };

  return (
    <div className="space-y-5">
      {/* ── Every screen preview (the banner image is applied to each) ── */}
      <div className="bg-[var(--color-bg-white)] rounded-3xl border border-[var(--color-border-default)] shadow-sm overflow-hidden p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">How it looks on every screen</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {draft.imageUrl
                ? 'Your banner image is applied to every placement below.'
                : 'No banner image yet — upload one in the Offer step and it will appear on every screen here.'}
            </p>
          </div>
          {draft.imageUrl && (
            <span className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-emerald-500-solid)]" /> Banner attached
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SCREENS.map((s) => (
            <div key={s.id} className="rounded-2xl border border-[var(--color-border-default)] bg-gray-50/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-extrabold text-gray-800 flex items-center gap-1.5">
                  <span>{s.emoji}</span> {s.label}
                </p>
                <span className="text-[9px] text-gray-400">{s.hint}</span>
              </div>
              <div className={`bg-[var(--color-bg-white)] rounded-xl overflow-hidden border border-gray-100 shadow-sm ${s.width}`}>
                <PromotionCreative
                  creative={creative}
                  templateId={s.id}
                  discountLabel={discountLabel}
                  restaurantName=""
                  scale={1}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Checkout / coupon card ── */}
      <div className="bg-[var(--color-bg-white)] rounded-3xl border border-[var(--color-border-default)] shadow-sm overflow-hidden">
        <div className="px-6 pt-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            At checkout · the offer card a customer sees
          </p>
        </div>

        {/* Coupon-style header */}
        <div className="bg-gradient-to-br from-[var(--brand-color)] to-blue-500 text-white px-6 py-5 relative mt-3">
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-[radial-gradient(circle_at_left,transparent_14px,#fff_15px)] opacity-90" />
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-100">{title} 🎉</p>
          <p className="text-3xl font-black mt-1 tracking-tight">{discountLabel}</p>
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
    </div>
  );
}

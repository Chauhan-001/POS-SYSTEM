/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing shared helpers — human-friendly labels/icons for the redesigned
 * Marketing workspace. All technical terms (recommendationSource, segmentId,
 * offer status enums) are mapped to friendly copy here so the UI never leaks
 * internal concepts.
 */

import React from 'react';
import { Loader2, Sparkles, ArrowLeft, ChevronRight } from 'lucide-react';

// ─── Recommendation sources → friendly opportunity copy ─────────────

export interface OpportunityMeta {
  icon: string;
  eyebrow: string;
  title: string;
  tone: string; // tailwind gradient classes
}

const RECOMMENDATION_META: Record<string, OpportunityMeta> = {
  weather: { icon: '🌤️', eyebrow: 'Weather opportunity', title: 'Weather-based promotion', tone: 'from-sky-50 to-white' },
  festival: { icon: '🎉', eyebrow: 'Festival promotion', title: 'Festival celebration', tone: 'from-amber-50 to-white' },
  inventory_clearance: { icon: '📦', eyebrow: 'Inventory opportunity', title: 'Clear excess stock', tone: 'from-orange-50 to-white' },
  inventory_low_stock_protection: { icon: '📦', eyebrow: 'Inventory opportunity', title: 'Limited stock offer', tone: 'from-orange-50 to-white' },
  time_based: { icon: '⏰', eyebrow: 'Timing opportunity', title: 'Happy hour boost', tone: 'from-indigo-50 to-white' },
  weekend: { icon: '🔥', eyebrow: 'Weekend opportunity', title: 'Weekend promotion', tone: 'from-rose-50 to-white' },
  slow_day: { icon: '📉', eyebrow: 'Slow day opportunity', title: 'Turn a quiet day around', tone: 'from-slate-50 to-white' },
  weak_category: { icon: '🎯', eyebrow: 'Category opportunity', title: 'Boost a slow category', tone: 'from-violet-50 to-white' },
  high_margin_promotion: { icon: '💰', eyebrow: 'Profit opportunity', title: 'Promote high-margin items', tone: 'from-emerald-50 to-white' },
  combo_upsell: { icon: '🧺', eyebrow: 'Combo opportunity', title: 'Bundle items together', tone: 'from-teal-50 to-white' },
  first_visit: { icon: '👋', eyebrow: 'New customer opportunity', title: 'Welcome new customers', tone: 'from-blue-50 to-white' },
  new_menu: { icon: '✨', eyebrow: 'Menu opportunity', title: 'Feature a new item', tone: 'from-blue-50 to-white' },
  seasonal_menu: { icon: '🍂', eyebrow: 'Seasonal opportunity', title: 'Seasonal special', tone: 'from-amber-50 to-white' },
  repeat_customer: { icon: '🔁', eyebrow: 'Retention opportunity', title: 'Bring customers back', tone: 'from-pink-50 to-white' },
  lost_customer: { icon: '💬', eyebrow: 'Retention opportunity', title: 'Bring customers back', tone: 'from-pink-50 to-white' },
  vip_reward: { icon: '👑', eyebrow: 'VIP opportunity', title: 'Reward your VIPs', tone: 'from-yellow-50 to-white' },
  birthday: { icon: '🎂', eyebrow: 'Birthday opportunity', title: 'Birthday promotion', tone: 'from-pink-50 to-white' },
  anniversary: { icon: '💍', eyebrow: 'Anniversary opportunity', title: 'Anniversary special', tone: 'from-rose-50 to-white' },
  referral: { icon: '🤝', eyebrow: 'Referral opportunity', title: 'Referral promotion', tone: 'from-emerald-50 to-white' },
};

export function opportunityMeta(source?: string): OpportunityMeta {
  return RECOMMENDATION_META[source || ''] || { icon: '✨', eyebrow: 'Opportunity', title: 'Promotion idea', tone: 'from-purple-50 to-white' };
}

// ─── Offer types → friendly labels ─────────────────────────────────

export const OFFER_TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage OFF',
  flat: 'Flat ₹ OFF',
  bogo: 'Buy 1 Get 1',
  free_item: 'Free item',
  combo: 'Combo deal',
  cashback: 'Cashback',
  reward_points: 'Reward points',
  coupon: 'Coupon',
  festival: 'Festival offer',
  referral: 'Referral',
  loyalty_bonus: 'Loyalty bonus',
};

export const OFFER_TYPE_ICONS: Record<string, string> = {
  percentage: '%', flat: '₹', bogo: '2×1', free_item: '🎁', combo: '📦',
  cashback: '💵', reward_points: '⭐', coupon: '🎟️', festival: '🎉',
  referral: '👥', loyalty_bonus: '💎',
};

export function offerValueLabel(type: string, value: number, currencySymbol = '₹'): string {
  switch (type) {
    case 'percentage': return `${value}% OFF`;
    case 'flat': case 'cashback': case 'coupon': return `${currencySymbol}${value} OFF`;
    case 'reward_points': return `${value} points`;
    case 'bogo': return 'Buy 1 Get 1';
    case 'free_item': return 'Free item';
    case 'combo': return `Combo · ${currencySymbol}${value}`;
    default: return `${value}`;
  }
}

// ─── Audience friendly copy ────────────────────────────────────────

export interface AudienceOption {
  id: string;
  label: string;
  hint: string;
  /** Segment type matched against the backend segment engine, when applicable. */
  segmentType?: string;
  tier?: string;
}

export const AUDIENCE_OPTIONS: AudienceOption[] = [
  { id: 'everyone', label: 'Everyone', hint: 'All your customers', segmentType: undefined },
  { id: 'new', label: 'New customers', hint: 'Visitors on their first visit', segmentType: 'new_customer' },
  { id: 'returning', label: 'Returning customers', hint: 'Customers who have visited before', segmentType: 'returning_customer' },
  { id: 'vip', label: 'VIP customers', hint: 'Your top spenders', segmentType: 'vip_customer' },
  { id: 'inactive', label: "Haven't visited recently", hint: 'Bring dormant customers back', segmentType: 'dormant_30d' },
  { id: 'tier', label: 'A specific loyalty tier', hint: 'Bronze, Silver, Gold, Platinum or Diamond', tier: 'Gold' },
  { id: 'custom', label: 'Specific audience', hint: 'Pick from your saved customer segments', segmentType: undefined },
];

export const LOYALTY_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

// ─── Small UI atoms ────────────────────────────────────────────────

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin" />
      {label && <span className="text-xs font-semibold">{label}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, cta }: { icon: React.ReactNode; title: string; subtitle: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3 text-3xl">{icon}</div>
      <p className="text-sm font-bold text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-sm">{subtitle}</p>
      {cta && <div className="mt-4 flex gap-2">{cta}</div>}
    </div>
  );
}

export function AiTag({ children }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-full">
      <Sparkles className="w-2.5 h-2.5" /> {children || 'AI'}
    </span>
  );
}

export function SectionTitle({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div className="mb-4">
      {eyebrow && <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{eyebrow}</p>}
      <h3 className="text-sm font-extrabold text-gray-900">{title}</h3>
    </div>
  );
}

export function BackHeader({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
      <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div>
        <h2 className="text-sm font-extrabold text-gray-900">{title}</h2>
        {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}

export function StepDots({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className={`w-3 h-3 ${done ? 'text-[var(--brand-color)]' : 'text-gray-300'}`} />}
            <span
              className={`text-[9px] font-bold px-2.5 py-1 rounded-full transition-all ${
                active ? 'bg-[var(--brand-color)] text-white shadow-sm' : done ? 'bg-blue-50 text-[var(--brand-color)]' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Format a number with Indian-style grouping. */
export function fmtNumber(n?: number | null): string {
  const v = Number(n || 0);
  return v.toLocaleString('en-IN');
}

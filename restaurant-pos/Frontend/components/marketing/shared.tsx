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
  ai: { icon: '✨', eyebrow: 'AI recommendation', title: 'AI-powered suggestion', tone: 'from-purple-50 to-white' },
  new_menu: { icon: '✨', eyebrow: 'Menu opportunity', title: 'Feature a new item', tone: 'from-blue-50 to-white' },
  seasonal_menu: { icon: '🍂', eyebrow: 'Seasonal opportunity', title: 'Seasonal special', tone: 'from-amber-50 to-white' },
  repeat_customer: { icon: '🔁', eyebrow: 'Retention opportunity', title: 'Bring customers back', tone: 'from-pink-50 to-white' },
  lost_customer: { icon: '💬', eyebrow: 'Retention opportunity', title: 'Bring customers back', tone: 'from-pink-50 to-white' },
  vip_reward: { icon: '👑', eyebrow: 'VIP opportunity', title: 'Reward your VIPs', tone: 'from-yellow-50 to-white' },
  birthday: { icon: '🎂', eyebrow: 'Birthday opportunity', title: 'Birthday promotion', tone: 'from-pink-50 to-white' },
  anniversary: { icon: '💍', eyebrow: 'Anniversary opportunity', title: 'Anniversary special', tone: 'from-rose-50 to-white' },
  referral: { icon: '🤝', eyebrow: 'Referral opportunity', title: 'Referral promotion', tone: 'from-emerald-50 to-white' },
  margin_protection: { icon: '🛡️', eyebrow: 'Margin safety', title: 'Hold discounts — thin margin', tone: 'from-red-50 to-white' },
  cost_increase_warning: { icon: '📈', eyebrow: 'Cost alert', title: 'Ingredient costs rising', tone: 'from-amber-50 to-white' },
  margin_deterioration: { icon: '📉', eyebrow: 'Margin deterioration', title: 'Review pricing — costs rose', tone: 'from-red-50 to-white' },
  wastage_alert: { icon: '🗑️', eyebrow: 'Wastage alert', title: 'Waste investigation', tone: 'from-orange-50 to-white' },
};

export function opportunityMeta(source?: string): OpportunityMeta {
  return RECOMMENDATION_META[source || ''] || { icon: '✨', eyebrow: 'Opportunity', title: 'Promotion idea', tone: 'from-purple-50 to-white' };
}

// ─── Offer provenance (recommendationSource) → subtle creator badge ──
// Where an offer came from (AI / rules / inventory / manual). Purely
// informational — it never changes the offer's financial behavior.

const PROVENANCE_LABELS: Record<string, { label: string; cls: string }> = {
  ai: { label: 'AI Recommended', cls: 'text-purple-600 bg-purple-50 border-purple-100' },
  analytics_proven: { label: 'Proven Offer', cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  rule: { label: 'Rule Recommended', cls: 'text-sky-600 bg-sky-50 border-sky-100' },
  rules: { label: 'Rule Recommended', cls: 'text-sky-600 bg-sky-50 border-sky-100' },
  inventory_clearance: { label: 'Inventory Opportunity', cls: 'text-orange-600 bg-orange-50 border-orange-100' },
  inventory_low_stock_protection: { label: 'Inventory Opportunity', cls: 'text-orange-600 bg-orange-50 border-orange-100' },
  slow_day: { label: 'Slow-Day Opportunity', cls: 'text-slate-600 bg-slate-50 border-slate-200' },
  time_based: { label: 'Timing Opportunity', cls: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
  weekend: { label: 'Weekend Opportunity', cls: 'text-rose-600 bg-rose-50 border-rose-100' },
  festival: { label: 'Festival Opportunity', cls: 'text-amber-600 bg-amber-50 border-amber-100' },
  combo_upsell: { label: 'Combo Opportunity', cls: 'text-teal-600 bg-teal-50 border-teal-100' },
  high_margin_promotion: { label: 'Profit Opportunity', cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  weak_category: { label: 'Category Opportunity', cls: 'text-violet-600 bg-violet-50 border-violet-100' },
  margin_protection: { label: 'Margin Safety', cls: 'text-red-600 bg-red-50 border-red-100' },
  cost_increase_warning: { label: 'Cost Alert', cls: 'text-amber-600 bg-amber-50 border-amber-100' },
  margin_deterioration: { label: 'Margin Deterioration', cls: 'text-red-600 bg-red-50 border-red-100' },
  wastage_alert: { label: 'Wastage Alert', cls: 'text-orange-600 bg-orange-50 border-orange-100' },
  manual: { label: 'Manual', cls: 'text-gray-500 bg-gray-50 border-gray-200' },
};

export function provenanceBadge(source?: string): { label: string; cls: string } | null {
  if (!source) return null;
  return PROVENANCE_LABELS[String(source)] || { label: 'Recommended', cls: 'text-gray-500 bg-gray-50 border-gray-200' };
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
    case 'percentage': case 'festival': return `${value}% OFF`;
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

// ─── Copy tone + language options (offer messages / Studio / Promote) ──
// One source of truth so the Create wizard, the Promote flow and the Studio
// ask the owner the same question with the same choices. The ids are the
// values sent to /api/ai/offer-copy and the promotion-copy endpoint.

export interface CopyToneOption { id: string; label: string; hint: string }
export interface CopyLanguageOption { id: string; label: string; hint: string }

export const COPY_TONES: CopyToneOption[] = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm & welcoming' },
  { id: 'funky', label: 'Funky', hint: 'Bold, playful & energetic' },
  { id: 'zomato', label: 'Zomato style', hint: 'Short, witty & foodie fun' },
  { id: 'professional', label: 'Professional', hint: 'Polished & trustworthy' },
  { id: 'premium', label: 'Premium', hint: 'Elegant & exclusive' },
  { id: 'festive', label: 'Festive', hint: 'Celebration energy' },
  { id: 'genz', label: 'Gen Z', hint: 'Casual, meme-adjacent' },
  { id: 'minimal', label: 'Minimal', hint: 'Short & clean' },
];

export const COPY_LANGUAGES: CopyLanguageOption[] = [
  { id: 'en', label: 'English', hint: 'Clear English' },
  { id: 'hi', label: 'Hindi', hint: 'हिंदी में लिखें' },
  { id: 'hinglish', label: 'Hinglish', hint: 'Hindi + English mix' },
];

export function copyToneLabel(id?: string): string {
  return COPY_TONES.find((t) => t.id === id)?.label || 'Friendly';
}

export function copyLanguageLabel(id?: string): string {
  return COPY_LANGUAGES.find((l) => l.id === id)?.label || 'English';
}

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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CreatePromotion — a 30-60 second progressive promotion builder.
 *
 *   Goal → Offer → Audience → Schedule → Channels & Coupon → Preview → Save
 *
 * Everything maps onto the existing Offer schema; the server stays the source
 * of truth (validation, state machine, coupon uniqueness, tenant scoping).
 * AI is advisory only: it prefills suggestions/copy, never auto-publishes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, Wand2, Plus, Minus, RefreshCw, Loader2, CheckCircle, Tag, Percent, Users, CalendarClock, Send, Eye, Save } from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import { StepDots, AiTag, OFFER_TYPE_LABELS, OFFER_TYPE_ICONS, offerValueLabel, fmtNumber, LOYALTY_TIERS, AUDIENCE_OPTIONS, type AudienceOption } from './shared';
import { estimateAudience, resolveAudience } from './useMarketingData';
import { PromotionPreview } from './PromotionPreview';

interface CreatePromotionProps {
  currencySymbol: string;
  products: any[];
  segments: any[];
  prefill: any; // { mode: 'suggestion', suggestion } | { mode: 'goal', goal } | null
  onDone: (status: 'draft' | 'active' | 'scheduled') => void;
  onCancel: () => void;
}

interface DraftOffer {
  title: string;
  description: string;
  type: string;
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  scope: 'order' | 'products' | 'categories';
  productIds: string[];
  categories: string[];
  audienceChoice: string;
  customSegmentIds: string[];
  tier?: string;
  runMode: 'now' | 'schedule';
  startDate: string;
  endDate: string;
  scheduledDate: string;
  repeatWeekly: boolean;
  daysOfWeek: number[];
  startHour: string;
  endHour: string;
  channels: Record<string, boolean>;
  message: string;
  emailSubject: string;
  emailBody: string;
  couponEnabled: boolean;
  couponCode: string;
  status: 'draft' | 'active' | 'scheduled';
  recommendationSource?: string;
  recommendationReason?: string;
  estimatedReach?: number;
  isAiGenerated?: boolean;
}

const GOALS: { id: string; icon: string; title: string; desc: string; preset: Partial<DraftOffer> }[] = [
  {
    id: 'increase_sales', icon: '📈', title: 'Increase sales', desc: 'Get more orders during a specific period.',
    preset: { type: 'percentage', value: 20, minOrderValue: 499, scope: 'order', daysOfWeek: [5, 6, 0], startHour: '14', endHour: '18' },
  },
  {
    id: 'clear_inventory', icon: '📦', title: 'Clear inventory', desc: "Promote products that aren't selling quickly.",
    preset: { type: 'percentage', value: 20, scope: 'order', runMode: 'now' },
  },
  {
    id: 'bring_customers_back', icon: '💬', title: 'Bring customers back', desc: 'Re-engage inactive customers.',
    preset: { type: 'flat', value: 100, minOrderValue: 499, scope: 'order', audienceChoice: 'inactive' },
  },
  {
    id: 'increase_aov', icon: '🛒', title: 'Increase average bill', desc: 'Encourage customers to spend more.',
    preset: { type: 'percentage', value: 15, minOrderValue: 800, scope: 'order' },
  },
  {
    id: 'festival', icon: '🎉', title: 'Promote a festival', desc: 'Create a seasonal promotion.',
    preset: { type: 'festival', value: 15, scope: 'order' },
  },
  {
    id: 'product', icon: '🍽️', title: 'Promote a product', desc: 'Push a specific item or category.',
    preset: { type: 'percentage', value: 15, scope: 'products' },
  },
  { id: 'custom', icon: '✨', title: 'Something else', desc: 'Create your own promotion.', preset: {} },
];

const STEP_LABELS = ['Goal', 'Offer', 'Audience', 'Schedule', 'Channels', 'Preview'];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function emptyDraft(): DraftOffer {
  return {
    title: '', description: '', type: 'percentage', value: 10, minOrderValue: undefined, maxDiscount: undefined,
    scope: 'order', productIds: [], categories: [],
    audienceChoice: 'everyone', customSegmentIds: [], tier: undefined,
    runMode: 'now', startDate: '', endDate: '', scheduledDate: '', repeatWeekly: false, daysOfWeek: [], startHour: '11', endHour: '22',
    channels: { checkout: true, website: true, whatsapp: false, sms: false, push: false, email: false },
    message: '', emailSubject: '', emailBody: '', couponEnabled: false, couponCode: '',
    status: 'draft',
  };
}

const COUPON_WORDS = ['SAVE', 'WEEKEND', 'FESTIVE', 'VIP', 'WELCOME', 'TREAT', 'EXTRA', 'FRESH', 'HAPPY', 'SPECIAL'];

function generateCoupon(): string {
  const a = COUPON_WORDS[Math.floor(Math.random() * COUPON_WORDS.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${a}${n}`;
}

export default function CreatePromotion({ currencySymbol, products, segments, prefill, onDone, onCancel }: CreatePromotionProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftOffer>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ─── Apply a prefill coming from another tab (recommendation or edit) ──
  // Runs once on mount. applySuggestion/applyEdit are declared below, but the
  // effect callback executes after the first render, so the closures are fully
  // initialized — this is safe and keeps the builder state-driven.
  useEffect(() => {
    if (prefill?.mode === 'suggestion' && prefill.suggestion) {
      applySuggestion(prefill.suggestion);
    } else if (prefill?.mode === 'edit' && prefill.offer) {
      applyEdit(prefill.offer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load an existing offer into the builder for editing (updates, not creates). */
  const applyEdit = (offer: any) => {
    const daysOfWeek: number[] = Array.isArray(offer.daysOfWeek) ? offer.daysOfWeek : [];
    const channels: Record<string, boolean> = {
      checkout: true,
      website: true,
      whatsapp: !!offer.whatsappMessage,
      sms: !!offer.smsMessage,
      push: !!offer.appNotification,
      email: !!(offer.emailSubject || offer.emailBody),
    };
    const audienceChoice =
      Array.isArray(offer.targetSegmentIds) && offer.targetSegmentIds.length > 0 ? 'custom'
        : Array.isArray(offer.targetTier) && offer.targetTier.length > 0 ? 'tier'
          : 'everyone';
    const scope =
      Array.isArray(offer.applicableProductIds) && offer.applicableProductIds.length > 0 ? 'products'
        : Array.isArray(offer.applicableCategories) && offer.applicableCategories.length > 0 ? 'categories'
          : 'order';
    setEditingId(offer._id || offer.id || null);
    setDraft({
      ...emptyDraft(),
      title: offer.title || '',
      description: offer.description || '',
      type: offer.type || 'percentage',
      value: offer.value ?? 10,
      minOrderValue: offer.minOrderValue || undefined,
      maxDiscount: offer.maxDiscount || undefined,
      scope,
      productIds: Array.isArray(offer.applicableProductIds) ? offer.applicableProductIds : [],
      categories: Array.isArray(offer.applicableCategories) ? offer.applicableCategories : [],
      audienceChoice,
      customSegmentIds: Array.isArray(offer.targetSegmentIds) ? offer.targetSegmentIds : [],
      tier: Array.isArray(offer.targetTier) && offer.targetTier.length ? offer.targetTier[0] : undefined,
      runMode: offer.scheduledDate ? 'schedule' : 'now',
      startDate: String(offer.startDate || '').slice(0, 10),
      endDate: String(offer.endDate || '').slice(0, 10),
      scheduledDate: String(offer.scheduledDate || '').slice(0, 10),
      repeatWeekly: daysOfWeek.length > 0,
      daysOfWeek,
      startHour: offer.startHour != null ? String(offer.startHour) : '11',
      endHour: offer.endHour != null ? String(offer.endHour) : '22',
      channels,
      message: offer.whatsappMessage || offer.smsMessage || '',
      emailSubject: offer.emailSubject || '',
      emailBody: offer.emailBody || '',
      couponEnabled: !!offer.couponCode,
      couponCode: offer.couponCode || '',
      status: offer.status || 'draft',
    });
    setStep(1);
  };

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);

  // ─── Prefill from a recommendation / goal ─────────────────────
  const applySuggestion = (s: any) => {
    setDraft((d) => ({
      ...d,
      title: s.title || d.title,
      description: s.description || d.description,
      type: s.type || d.type,
      value: s.value ?? d.value,
      minOrderValue: s.minOrderValue,
      maxDiscount: s.maxDiscount,
      daysOfWeek: s.daysOfWeek || d.daysOfWeek,
      startHour: s.startHour !== undefined ? String(s.startHour) : d.startHour,
      endHour: s.endHour !== undefined ? String(s.endHour) : d.endHour,
      audienceChoice: d.audienceChoice,
      recommendationSource: s.recommendationSource,
      recommendationReason: s.recommendationReason,
      estimatedReach: s.estimatedReach,
      isAiGenerated: s.recommendationSource ? true : d.isAiGenerated,
      scope: (s.applicableCategories && s.applicableCategories.length > 0) ? 'categories' : 'order',
      categories: s.applicableCategories || [],
    }));
    setStep(1);
  };

  const startWithGoal = (goalId: string) => {
    const goal = GOALS.find((g) => g.id === goalId);
    if (!goal) return;
    setDraft((d) => ({ ...emptyDraft(), ...goal.preset, title: '', description: goal.desc }));
    setStep(1);
  };

  const askAi = async () => {
    setAiBusy(true);
    setError('');
    try {
      const res = await api.fetchOfferRecommendations();
      const suggestions = res?.suggestions || [];
      if (suggestions.length > 0) {
        applySuggestion(suggestions[0]);
      } else {
        // Fall back to the marketing plan AI with a generic brief.
        const plan = await api.generateMarketingPlan({ request: 'Suggest a promotion that brings in more orders this week.' });
        const p = plan?.plan;
        if (p?.offer) {
          applySuggestion({
            title: p.offer.title, description: p.offer.description, type: p.offer.type, value: p.offer.value,
            minOrderValue: p.offer.minOrderValue, maxDiscount: p.offer.maxDiscount, recommendationReason: p.reason,
            estimatedReach: undefined, recommendationSource: 'manual', applicableCategories: [],
          });
        } else {
          setError('We couldn\u2019t generate an AI recommendation right now. Try creating one manually.');
        }
      }
    } catch (err) {
      debugWarn('CreatePromotion', 'AI recommend failed:', err);
      setError('We couldn\u2019t generate an AI recommendation right now. Try creating one manually.');
    } finally {
      setAiBusy(false);
    }
  };

  const generateMessage = async () => {
    setAiBusy(true);
    try {
      const res = await api.generateOfferCopy({
        type: draft.type, value: draft.value,
        discountValue: offerValueLabel(draft.type, draft.value, currencySymbol),
        applicableCategories: draft.categories.length ? draft.categories : undefined,
        targetAudience: AUDIENCE_OPTIONS.find((a) => a.id === draft.audienceChoice)?.label,
        reason: draft.recommendationReason || undefined,
        minOrderValue: draft.minOrderValue,
        durationDays: draft.runMode === 'schedule' && draft.endDate && draft.startDate
          ? Math.max(1, Math.round((new Date(draft.endDate).getTime() - new Date(draft.startDate).getTime()) / 86400000)) : 7,
        language: 'en',
      });
      const data = res?.data || res;
      if (data) {
        setDraft((d) => ({
          ...d,
          message: data.whatsapp || data.sms || d.message,
          emailSubject: data.emailSubject || d.emailSubject,
          emailBody: data.emailBody || d.emailBody,
          title: data.title || d.title,
          description: data.description || d.description,
        }));
      }
    } catch (err) {
      debugWarn('CreatePromotion', 'copy generation failed:', err);
      setError('AI copy is unavailable right now — keep the message or write your own.');
    } finally {
      setAiBusy(false);
    }
  };

  // ─── Audience estimate (real segment counts) ──────────────────
  const audienceSize = useMemo(() => estimateAudience(segments, draft.audienceChoice, draft.tier, draft.customSegmentIds), [segments, draft.audienceChoice, draft.tier, draft.customSegmentIds]);

  const canNext = (): boolean => {
    if (step === 0) return true;
    if (step === 1) {
      if (!draft.type || draft.value <= 0) return false;
      if (draft.scope === 'products' && draft.productIds.length === 0) return false;
      return true;
    }
    if (step === 3) {
      if (draft.runMode === 'schedule' && (!draft.startDate || !draft.endDate)) return false;
      if (draft.repeatWeekly && draft.daysOfWeek.length === 0) return false;
    }
    if (step === 4) {
      const messagingChannels = ['whatsapp', 'sms', 'push', 'email'].filter((c) => draft.channels[c]);
      if (messagingChannels.length > 0 && !draft.message.trim()) return false;
    }
    return true;
  };

  // ─── Save ─────────────────────────────────────────────────────
  const saveOffer = async (status: 'draft' | 'active' | 'scheduled') => {
    setSaving(true);
    setError('');
    try {
      const { segmentIds, tier } = resolveAudience(segments, draft.audienceChoice, draft.tier, draft.customSegmentIds);
      const title = draft.title.trim() || autoTitle(draft, currencySymbol);
      const now = new Date().toISOString().slice(0, 10);
      const payload: any = {
        title,
        description: draft.description.trim() || `${offerValueLabel(draft.type, draft.value, currencySymbol)}${draft.minOrderValue ? ` on orders above ${currencySymbol}${draft.minOrderValue}` : ''}.`,
        shortDescription: `${offerValueLabel(draft.type, draft.value, currencySymbol)}`,
        type: draft.type,
        value: draft.value,
        ...(draft.minOrderValue ? { minOrderValue: draft.minOrderValue } : {}),
        ...(draft.maxDiscount ? { maxDiscount: draft.maxDiscount } : {}),
        applicableCategories: draft.scope === 'categories' ? draft.categories : [],
        applicableProductIds: draft.scope === 'products' ? draft.productIds : [],
        targetSegmentIds: segmentIds,
        targetSegmentNames: segments.filter((s) => segmentIds.includes(s._id)).map((s) => s.name),
        ...(tier ? { targetTier: [tier] } : {}),
        daysOfWeek: draft.repeatWeekly ? draft.daysOfWeek : undefined,
        ...(draft.repeatWeekly && draft.startHour !== '' ? { startHour: parseInt(draft.startHour, 10) } : {}),
        ...(draft.repeatWeekly && draft.endHour !== '' ? { endHour: parseInt(draft.endHour, 10) } : {}),
        ...(draft.couponEnabled ? { couponCode: draft.couponCode } : {}),
        ...(draft.channels.whatsapp ? { whatsappMessage: draft.message } : {}),
        ...(draft.channels.sms ? { smsMessage: draft.message } : {}),
        ...(draft.channels.push ? { appNotification: draft.message } : {}),
        ...(draft.channels.email ? { emailSubject: draft.emailSubject || title, emailBody: draft.emailBody || draft.message } : {}),
        recommendationSource: draft.recommendationSource,
        recommendationReason: draft.recommendationReason,
        estimatedReach: draft.estimatedReach ?? audienceSize ?? undefined,
        isAiGenerated: draft.isAiGenerated,
        isAutoActivate: false,
        status,
      };

      if (status === 'scheduled') {
        payload.scheduledDate = draft.scheduledDate || draft.startDate || now;
        payload.startDate = draft.startDate || draft.scheduledDate;
      } else if (status === 'active') {
        // Editing an already-live offer keeps its original start date; only a
        // fresh activation (draft/scheduled → active) stamps today.
        if (!(editingId && draft.status === 'active')) {
          payload.startDate = draft.runMode === 'schedule' && draft.startDate ? draft.startDate : now;
        }
      }
      if (status !== 'draft' && draft.runMode === 'schedule' && draft.endDate) payload.endDate = draft.endDate;

      const created = editingId ? await api.updateOffer(editingId, payload) : await api.createOffer(payload);
      if (!created) { setError('Could not save the offer. Check your connection and try again.'); return; }
      onDone(status);
    } catch (err: any) {
      debugWarn('CreatePromotion', 'save failed:', err);
      const msg = err?.response?.data?.error || err?.message || 'Something went wrong while saving.';
      // Never surface raw validation codes — map to friendly copy.
      if (/coupon/i.test(msg)) setError('That coupon code is already in use. Generate a new one or pick another.');
      else setError('We couldn\u2019t save this offer. Check the details and try again.');
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<DraftOffer>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Create</p>
          <h3 className="text-sm font-extrabold text-gray-900">Create a promotion</h3>
        </div>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-bold cursor-pointer">Cancel</button>
      </div>

      <StepDots current={step} total={6} labels={STEP_LABELS} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-3">{error}</div>
      )}

      {/* STEP 0 — Goal */}
      {step === 0 && (
        <div className="space-y-5">
          <p className="text-sm font-bold text-gray-800">What do you want to achieve?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {GOALS.map((g) => (
              <button
                key={g.id}
                onClick={() => startWithGoal(g.id)}
                className="text-left bg-white border border-[#e1e2ed] rounded-2xl p-4 hover:border-[var(--brand-color)] hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="text-2xl">{g.icon}</span>
                <p className="text-sm font-extrabold text-gray-900 mt-2 group-hover:text-[var(--brand-color)] transition-colors">{g.title}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{g.desc}</p>
              </button>
            ))}
          </div>
          <button
            onClick={askAi}
            disabled={aiBusy}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl py-4 text-sm font-black shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-60"
          >
            {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {aiBusy ? 'Analyzing your restaurant…' : 'Let AI recommend an offer'}
          </button>
        </div>
      )}

      {/* STEP 1 — Offer config */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 space-y-5">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Discount type</label>
            <div className="flex flex-wrap gap-2">
              {['percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback', 'reward_points'].map((t) => (
                <button
                  key={t}
                  onClick={() => set({ type: t })}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    draft.type === t ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)] shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'
                  }`}
                >
                  <span>{OFFER_TYPE_ICONS[t]}</span> {OFFER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {(draft.type === 'percentage' || draft.type === 'flat' || draft.type === 'cashback' || draft.type === 'coupon' || draft.type === 'reward_points') && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">
                  {draft.type === 'percentage' ? 'Discount %' : draft.type === 'reward_points' ? 'Points' : `Amount (${currencySymbol})`}
                </label>
                <input
                  type="number" min={0} max={draft.type === 'percentage' ? 100 : undefined}
                  value={draft.value || ''} onChange={(e) => set({ value: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-[var(--brand-color)]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Minimum order</label>
                <div className="flex items-center border border-[#c3c6d7] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-200">
                  <span className="px-2 text-gray-400 text-sm font-bold">{currencySymbol}</span>
                  <input
                    type="number" min={0} value={draft.minOrderValue || ''} placeholder="None"
                    onChange={(e) => set({ minOrderValue: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full px-2 py-2.5 text-sm font-bold focus:outline-none"
                  />
                </div>
              </div>
              {draft.type === 'percentage' && (
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Max discount</label>
                  <div className="flex items-center border border-[#c3c6d7] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-200">
                    <span className="px-2 text-gray-400 text-sm font-bold">{currencySymbol}</span>
                    <input
                      type="number" min={0} value={draft.maxDiscount || ''} placeholder="None"
                      onChange={(e) => set({ maxDiscount: e.target.value ? Number(e.target.value) : undefined })}
                      className="w-full px-2 py-2.5 text-sm font-bold focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Applies to</label>
            <div className="flex flex-wrap gap-2">
              {(['order', 'products', 'categories'] as const).map((s) => (
                <button
                  key={s} onClick={() => set({ scope: s })}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    draft.scope === s ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-white border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'
                  }`}
                >
                  {s === 'order' ? 'Entire order' : s === 'products' ? 'Selected products' : 'Selected categories'}
                </button>
              ))}
            </div>
            {draft.scope === 'products' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {products.map((p) => {
                  const on = draft.productIds.includes(p.id);
                  return (
                    <button
                      key={p.id} onClick={() => set({ productIds: on ? draft.productIds.filter((x) => x !== p.id) : [...draft.productIds, p.id] })}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
            {draft.scope === 'categories' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {categories.map((c) => {
                  const on = draft.categories.includes(c);
                  return (
                    <button
                      key={c} onClick={() => set({ categories: on ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] })}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}
                    >
                      {c}
                    </button>
                  );
                })}
                {categories.length === 0 && <p className="text-[11px] text-gray-400">No menu categories yet. Add products first.</p>}
              </div>
            )}
          </div>

          {draft.type === 'bogo' && (
            <p className="text-[11px] text-gray-500 bg-blue-50 border border-blue-100 rounded-xl p-3">
              🧾 Buy 1 Get 1 — pick the free item after choosing products above, or leave it open to the entire order.
            </p>
          )}
        </div>
      )}

      {/* STEP 2 — Audience */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-800">Who should get this offer?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
              {AUDIENCE_OPTIONS.map((a: AudienceOption) => {
                const on = draft.audienceChoice === a.id;
                return (
                  <button
                    key={a.id} onClick={() => set({ audienceChoice: a.id })}
                    className={`text-left border rounded-2xl p-3.5 transition-all cursor-pointer ${on ? 'border-[var(--brand-color)] bg-blue-50/40 ring-2 ring-blue-100' : 'border-[#e1e2ed] bg-white hover:border-[var(--brand-color)]/40'}`}
                  >
                    <p className="text-xs font-extrabold text-gray-800">{a.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{a.hint}</p>
                  </button>
                );
              })}
            </div>

            {draft.audienceChoice === 'tier' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {LOYALTY_TIERS.map((t) => (
                  <button key={t} onClick={() => set({ tier: t })}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${draft.tier === t ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}

            {draft.audienceChoice === 'custom' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {segments.map((s: any) => {
                  const on = draft.customSegmentIds.includes(s._id);
                  return (
                    <button key={s._id} onClick={() => set({ customSegmentIds: on ? draft.customSegmentIds.filter((x) => x !== s._id) : [...draft.customSegmentIds, s._id] })}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600'}`}>
                      {s.name} · {s.customerCount}
                    </button>
                  );
                })}
                {segments.length === 0 && <p className="text-[11px] text-gray-400">No segments yet — refresh segments in Marketing settings.</p>}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
              <Users className="w-4 h-4 text-[var(--brand-color)]" />
              <span className="text-xs font-bold text-gray-700">
                {audienceSize ? `Estimated audience: ${fmtNumber(audienceSize)} customers` : draft.audienceChoice === 'tier' ? 'Based on loyalty tier' : 'All customers'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 — Schedule */}
      {step === 3 && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-800">When should this offer run?</p>
            <div className="flex gap-2 mt-3">
              {(['now', 'schedule'] as const).map((m) => (
                <button key={m} onClick={() => set({ runMode: m })}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${draft.runMode === m ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {m === 'now' ? 'Run now' : 'Schedule'}
                </button>
              ))}
            </div>
          </div>

          {draft.runMode === 'schedule' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Starts</label>
                <input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Ends</label>
                <input type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Publish date (when it goes live)</label>
                <input type="date" value={draft.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={draft.repeatWeekly} onChange={(e) => set({ repeatWeekly: e.target.checked })} className="w-4 h-4 rounded text-[var(--brand-color)] cursor-pointer" />
              <span className="text-xs font-extrabold text-gray-800">Repeat on specific days</span>
            </label>
            {draft.repeatWeekly && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((d, i) => {
                    const on = draft.daysOfWeek.includes(i);
                    return (
                      <button key={d} onClick={() => set({ daysOfWeek: on ? draft.daysOfWeek.filter((x) => x !== i) : [...draft.daysOfWeek, i] })}
                        className={`w-10 py-2 rounded-xl text-[11px] font-black cursor-pointer ${on ? 'bg-[var(--brand-color)] text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Between</label>
                  <select value={draft.startHour} onChange={(e) => set({ startHour: e.target.value })} className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold bg-white">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  <span className="text-gray-400 text-xs">and</span>
                  <select value={draft.endHour} onChange={(e) => set({ endHour: e.target.value })} className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold bg-white">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STEP 4 — Channels + coupon */}
      {step === 4 && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 space-y-6">
          <div>
            <p className="text-sm font-bold text-gray-800 mb-3">Where should customers see this?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {([
                { id: 'checkout', label: 'Checkout', icon: '🧾', note: 'Shown to your cashier to apply' },
                { id: 'website', label: 'Website', icon: '🌐', note: 'Shown on your public store page' },
                { id: 'whatsapp', label: 'WhatsApp', icon: '💬', note: 'Message customers' },
                { id: 'sms', label: 'SMS', icon: '📱', note: 'Text customers' },
                { id: 'push', label: 'Push notification', icon: '🔔', note: 'App notification' },
                { id: 'email', label: 'Email', icon: '📧', note: 'Email customers' },
              ]).map((c) => {
                const on = draft.channels[c.id];
                return (
                  <button key={c.id} onClick={() => set({ channels: { ...draft.channels, [c.id]: !on } })}
                    className={`text-left border rounded-2xl p-3.5 transition-all cursor-pointer ${on ? 'border-[var(--brand-color)] bg-blue-50/40 ring-2 ring-blue-100' : 'border-[#e1e2ed] bg-white hover:border-[var(--brand-color)]/40'}`}>
                    <span className="text-xl">{c.icon}</span>
                    <p className="text-xs font-extrabold text-gray-800 mt-1.5">{c.label}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">{c.note}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {(['whatsapp', 'sms', 'push', 'email'] as const).some((c) => draft.channels[c]) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider">Customer message</label>
                <button onClick={generateMessage} disabled={aiBusy}
                  className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 transition-colors cursor-pointer disabled:opacity-60">
                  {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generate message
                </button>
              </div>
              <textarea value={draft.message} onChange={(e) => set({ message: e.target.value })} rows={3}
                placeholder="e.g. 🎉 Weekend Special! Get 20% OFF orders above ₹499 this Saturday & Sunday."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
              {draft.channels.email && (
                <div className="grid grid-cols-1 gap-3">
                  <input value={draft.emailSubject} onChange={(e) => set({ emailSubject: e.target.value })} placeholder="Email subject"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <textarea value={draft.emailBody} onChange={(e) => set({ emailBody: e.target.value })} rows={3} placeholder="Email body"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
                </div>
              )}
            </div>
          )}

          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={draft.couponEnabled} onChange={(e) => set({ couponEnabled: e.target.checked, couponCode: e.target.checked ? generateCoupon() : '' })}
                className="w-4 h-4 rounded text-[var(--brand-color)] cursor-pointer" />
              <span className="text-xs font-extrabold text-gray-800">Add a coupon code?</span>
            </label>
            {draft.couponEnabled && (
              <div className="mt-3 flex items-center gap-2">
                <input value={draft.couponCode} onChange={(e) => set({ couponCode: e.target.value.toUpperCase() })}
                  className="w-48 px-3 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-black font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <button onClick={() => set({ couponCode: generateCoupon() })}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:border-[var(--brand-color)] cursor-pointer">
                  <RefreshCw className="w-3.5 h-3.5" /> Generate code
                </button>
              </div>
            )}
            {draft.couponEnabled && <p className="text-[10px] text-gray-400 mt-2">Customers can enter this code at checkout. It must be unique for your restaurant.</p>}
          </div>
        </div>
      )}

      {/* STEP 5 — Preview */}
      {step === 5 && (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><Eye className="w-4 h-4" /> Customer preview</p>
              <AiTag />
            </div>
            <PromotionPreview draft={draft} currencySymbol={currencySymbol} audienceSize={audienceSize} />
          </div>

          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 space-y-3">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Promotion summary</p>
            <SummaryRow icon={<Percent className="w-3.5 h-3.5" />} label="Offer" value={`${OFFER_TYPE_LABELS[draft.type]} · ${offerValueLabel(draft.type, draft.value, currencySymbol)}${draft.minOrderValue ? ` (min ${currencySymbol}${draft.minOrderValue})` : ''}`} />
            <SummaryRow icon={<Users className="w-3.5 h-3.5" />} label="Audience" value={draft.audienceChoice === 'tier' ? `${draft.tier} members` : AUDIENCE_OPTIONS.find((a) => a.id === draft.audienceChoice)?.label || 'Everyone'} />
            <SummaryRow icon={<CalendarClock className="w-3.5 h-3.5" />} label="Schedule" value={draft.runMode === 'now' ? 'Starts immediately' : `${draft.startDate || '—'} → ${draft.endDate || 'no end date'}${draft.repeatWeekly && draft.daysOfWeek.length ? ` · ${draft.daysOfWeek.map((d) => DAYS[d]).join(', ')}` : ''}`} />
            <SummaryRow icon={<Send className="w-3.5 h-3.5" />} label="Channels" value={Object.entries(draft.channels).filter(([, v]) => v).map(([k]) => k === 'push' ? 'Push' : k === 'checkout' ? 'Checkout' : k === 'website' ? 'Website' : k).join(' + ') || '—'} />
            {draft.couponEnabled && <SummaryRow icon={<Tag className="w-3.5 h-3.5" />} label="Coupon" value={draft.couponCode} mono />}
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        ) : <span />}

        {step < 5 ? (
          <button onClick={() => canNext() && setStep(step + 1)} disabled={!canNext()}
            className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => saveOffer(editingId ? draft.status : 'draft')} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {editingId ? 'Save Changes' : 'Save Draft'}
            </button>
            {!editingId && draft.runMode === 'schedule' && draft.scheduledDate ? (
              <button onClick={() => saveOffer('scheduled')} disabled={saving}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-50">
                <CalendarClock className="w-3.5 h-3.5" /> Schedule Offer
              </button>
            ) : (
              <button onClick={() => saveOffer('active')} disabled={saving}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} {editingId ? 'Save & Activate' : 'Activate Offer'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function autoTitle(d: DraftOffer, currencySymbol: string): string {
  const base = d.type === 'percentage' ? `${d.value}% OFF` : d.type === 'flat' ? `${currencySymbol}${d.value} OFF` : OFFER_TYPE_LABELS[d.type];
  if (d.repeatWeekly && d.daysOfWeek.includes(5)) return `Weekend ${base}`;
  if (d.audienceChoice === 'inactive') return `Welcome back — ${base}`;
  if (d.audienceChoice === 'new') return `New customer — ${base}`;
  return `${base} promotion`;
}

function SummaryRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400">{icon}</span>
      <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider w-20 shrink-0">{label}</span>
      <span className={`text-xs font-bold text-gray-800 ${mono ? 'font-mono tracking-widest' : ''}`}>{value}</span>
    </div>
  );
}

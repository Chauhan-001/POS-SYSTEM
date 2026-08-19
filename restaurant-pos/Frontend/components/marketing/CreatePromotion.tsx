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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Wand2, Plus, Minus, RefreshCw, Loader2, CheckCircle, Tag, Percent, Users, CalendarClock, Send, Eye, Save, Palette, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import { StepDots, AiTag, OFFER_TYPE_LABELS, OFFER_TYPE_ICONS, offerValueLabel, fmtNumber, LOYALTY_TIERS, AUDIENCE_OPTIONS, COPY_TONES, COPY_LANGUAGES, type AudienceOption } from './shared';
import { estimateAudience, resolveAudience } from './useMarketingData';
import { PromotionPreview } from './PromotionPreview';
import { PROMO_TEMPLATES } from './promotionTemplates';
import PromotionCreative from './PromotionCreative';

interface CreatePromotionProps {
  currencySymbol: string;
  products: any[];
  segments: any[];
  /** Active branches — when > 1, the owner picks which branches the offer applies to (empty = all). */
  branches?: { id: string; name: string; isActive?: boolean }[];
  prefill: any; // { mode: 'suggestion', suggestion } | { mode: 'goal', goal } | null
  onDone: (status: 'draft' | 'active' | 'scheduled') => void;
  /** Called after a NEW offer is created, with its id — jump straight to the Promotion Studio banner flow. */
  onCreated?: (offerId: string) => void;
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
  /** Copy style + language for the generated customer message (Studio/Create/Promote). */
  copyTone: string;
  copyLanguage: string;
  couponEnabled: boolean;
  couponCode: string;
  /** Branch scope — empty array = all branches. Only surfaced when the restaurant has > 1 branch. */
  branchIds: string[];
  /** Offer banner image URL (optional) — shown on the offer and reusable by the Promotion Studio. */
  imageUrl?: string;
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

const STEP_LABELS = ['Goal', 'Offer', 'Audience', 'Schedule', 'Channels', 'Studio', 'Preview'];

/** Creative state for the Studio step — mirrors the Promotion Studio's creative. */
interface WizardCreative {
  templateId: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  colors: { background: string; text: string; accent: string };
  imageUrl: string | null;
}

function emptyCreative(): WizardCreative {
  return {
    templateId: 'hero-banner',
    title: '', subtitle: '', description: '', cta: 'Order Now',
    colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
    imageUrl: null,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function emptyDraft(): DraftOffer {
  return {
    title: '', description: '', type: 'percentage', value: 10, minOrderValue: undefined, maxDiscount: undefined,
    scope: 'order', productIds: [], categories: [],
    audienceChoice: 'everyone', customSegmentIds: [], tier: undefined,
    runMode: 'now', startDate: '', endDate: '', scheduledDate: '', repeatWeekly: false, daysOfWeek: [], startHour: '11', endHour: '22',
    channels: { checkout: true, website: true, whatsapp: false, sms: false, push: false, email: false },
    message: '', emailSubject: '', emailBody: '', couponEnabled: false, couponCode: '',
    copyTone: 'friendly', copyLanguage: 'en',
    branchIds: [],
    imageUrl: '',
    status: 'draft',
  };
}

const COUPON_WORDS = ['SAVE', 'WEEKEND', 'FESTIVE', 'VIP', 'WELCOME', 'TREAT', 'EXTRA', 'FRESH', 'HAPPY', 'SPECIAL'];

function generateCoupon(): string {
  const a = COUPON_WORDS[Math.floor(Math.random() * COUPON_WORDS.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${a}${n}`;
}

export default function CreatePromotion({ currencySymbol, products, segments, branches = [], prefill, onDone, onCreated }: CreatePromotionProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftOffer>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);

  const uploadOfferImage = async (file: File) => {
    setImageUploading(true);
    setError('');
    try {
      const url = await api.uploadImage(file);
      if (url) set({ imageUrl: url });
      else setError('Image upload failed. Try a smaller JPG/PNG/WebP.');
    } catch {
      setError('Image upload failed. Try again.');
    } finally {
      setImageUploading(false);
    }
  };
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ id: string; title: string; status: 'draft' | 'active' | 'scheduled' } | null>(null);

  // ─── Studio step state (design the banner / whole image) ────────
  const [creative, setCreative] = useState<WizardCreative>(emptyCreative);
  const [creativeTouched, setCreativeTouched] = useState(false);
  const studioImageRef = useRef<HTMLInputElement>(null);
  const [studioImageUploading, setStudioImageUploading] = useState(false);

  // Prefill the Studio step from the offer draft the first time the owner
  // reaches it, so the banner starts from the real offer details.
  useEffect(() => {
    if (step === 5 && !creativeTouched) {
      setCreative({
        templateId: 'hero-banner',
        title: draft.title,
        subtitle: `${offerValueLabel(draft.type, draft.value, currencySymbol)}${draft.minOrderValue ? ` · min ${currencySymbol}${draft.minOrderValue}` : ''}`,
        description: draft.description,
        cta: 'Order Now',
        colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
        imageUrl: draft.imageUrl || null,
      });
      setCreativeTouched(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const uploadStudioImage = async (file: File) => {
    setStudioImageUploading(true);
    setError('');
    try {
      const url = await api.uploadImage(file);
      if (url) setCreative((c) => ({ ...c, imageUrl: url }));
      else setError('Image upload failed. Try a smaller JPG/PNG/WebP.');
    } catch {
      setError('Image upload failed. Try again.');
    } finally {
      setStudioImageUploading(false);
    }
  };

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
      branchIds: Array.isArray(offer.branchIds) ? offer.branchIds : [],
      daysOfWeek,
      startHour: offer.startHour != null ? String(offer.startHour) : '11',
      endHour: offer.endHour != null ? String(offer.endHour) : '22',
      channels,
      message: offer.whatsappMessage || offer.smsMessage || '',
      emailSubject: offer.emailSubject || '',
      emailBody: offer.emailBody || '',
      copyTone: offer.copyTone || 'friendly',
      copyLanguage: offer.copyLanguage || 'en',
      couponEnabled: !!offer.couponCode,
      couponCode: offer.couponCode || '',
      imageUrl: offer.imageUrl || '',
      status: offer.status || 'draft',
    });
    setStep(1);
  };

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);

  // ─── Prefill from a recommendation / goal ─────────────────────
  const applySuggestion = (s: any) => {
    setDraft((d) => {
      // Coupon-type suggestions need a real (unique) code — generate one the
      // owner can change; they stay in control, the code is never forced.
      const couponType = s.type === 'coupon' && !d.couponEnabled;
      return {
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
      imageUrl: s.imageUrl || d.imageUrl,
      scope: (s.applicableCategories && s.applicableCategories.length > 0) ? 'categories' : 'order',
      categories: s.applicableCategories || [],
      couponEnabled: couponType ? true : d.couponEnabled,
      couponCode: couponType ? generateCoupon() : d.couponCode,
      };
    });
    setStep(1);
  };

  const startWithGoal = (goalId: string) => {
    const goal = GOALS.find((g) => g.id === goalId);
    if (!goal) return;
    setDraft((d) => ({ ...emptyDraft(), ...goal.preset, title: '', description: goal.desc }));
    setStep(1);
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
        tone: (draft.copyTone || 'friendly') as any,
        language: (draft.copyLanguage || 'en') as any,
        // Explicit user action — bypass the AI cache so Regenerate re-calls the LLM.
        bustCache: true,
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
    // Step 5 (Studio) has no required fields — the banner can stay simple.
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
        ...(draft.imageUrl ? { imageUrl: draft.imageUrl } : {}),
        ...(draft.couponEnabled ? { couponCode: draft.couponCode } : {}),
        ...(draft.channels.whatsapp ? { whatsappMessage: draft.message } : {}),
        ...(draft.channels.sms ? { smsMessage: draft.message } : {}),
        ...(draft.channels.push ? { appNotification: draft.message } : {}),
        ...(draft.channels.email ? { emailSubject: draft.emailSubject || title, emailBody: draft.emailBody || draft.message } : {}),
        // Branch scope — empty = all branches (server default). Only populated
        // when the restaurant runs multiple branches and the owner picked some.
        ...(draft.branchIds.length > 0 ? { branchIds: draft.branchIds } : { branchIds: [] }),
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
      const createdId = (created as any)?._id || (created as any)?.id;

      // New offers automatically get a draft promotion carrying the creative
      // designed in the Studio step — the banner is saved together with the
      // offer (best-effort; the offer itself is the source of truth).
      if (!editingId && createdId && creativeTouched) {
        try {
          await api.createPromotion({
            offerId: String(createdId),
            name: `${title} — Creative`,
            channels: draft.channels.website ? ['website', 'qr'] : ['website'],
            templateId: creative.templateId || 'hero-banner',
            creative: {
              title: creative.title, subtitle: creative.subtitle, description: creative.description,
              cta: creative.cta, language: draft.copyLanguage || 'en', tone: draft.copyTone || 'friendly',
              colors: creative.colors,
              image: creative.imageUrl ? { key: creative.imageUrl, source: 'uploaded' } : null,
              screenImages: {}, logoKey: null, productImageKeys: [], layout: creative.templateId || 'hero-banner',
            },
            generatedBy: 'template',
          });
        } catch (err) {
          debugWarn('CreatePromotion', 'promotion create failed', err);
        }
      }

      if (!editingId && createdId) {
        // Skip the success screen — go straight to the Studio so the merchant
        // can design the banner without an extra click.
        if (onCreated) {
          onCreated(String(createdId));
        } else {
          setSaved({ id: String(createdId), title, status });
        }
      } else {
        onDone(status);
      }
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
      <div>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Create</p>
        <h3 className="text-sm font-extrabold text-gray-900">Create a promotion</h3>
      </div>

      {!saved && <StepDots current={step} total={STEP_LABELS.length} labels={STEP_LABELS} />}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-3">{error}</div>
      )}

      {/* SAVED — success + next step (banner) ────────────────────── */}
      {saved && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-green-200 p-6 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
            <CheckCircle className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-black text-gray-900">Offer saved 🎉</p>
            <p className="text-xs text-gray-500 mt-1">
              “{saved.title}” is {saved.status === 'draft' ? 'saved as a draft' : saved.status === 'scheduled' ? 'scheduled' : 'now live'}.
            </p>
          </div>
          <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
            Your banner design was saved with the offer. Open the Studio anytime to fine-tune it or publish it to your website &amp; QR menu.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
            <button
              onClick={() => (onCreated ? onCreated(saved.id) : onDone(saved.status))}
              className="flex items-center gap-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-6 py-3 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer"
            >
              <Palette className="w-4 h-4" /> Create promotional banner
            </button>
            <button
              onClick={() => onDone(saved.status)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
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
                className="text-left bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-2xl p-4 hover:border-[var(--brand-color)] hover:shadow-md transition-all cursor-pointer group"
              >
                <span className="text-2xl">{g.icon}</span>
                <p className="text-sm font-extrabold text-gray-900 mt-2 group-hover:text-[var(--brand-color)] transition-colors">{g.title}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{g.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 1 — Offer config */}
      {step === 1 && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-5">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Discount type</label>
            <div className="flex flex-wrap gap-2">
              {['percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback', 'reward_points', 'coupon', 'festival'].map((t) => (
                <button
                  key={t}
                  onClick={() => set({ type: t })}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    draft.type === t ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)] shadow-sm' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'
                  }`}
                >
                  <span>{OFFER_TYPE_ICONS[t]}</span> {OFFER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {(draft.type === 'percentage' || draft.type === 'festival' || draft.type === 'flat' || draft.type === 'cashback' || draft.type === 'coupon' || draft.type === 'reward_points') && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">
                  {draft.type === 'percentage' || draft.type === 'festival' ? 'Discount %' : draft.type === 'reward_points' ? 'Points' : `Amount (${currencySymbol})`}
                </label>
                <input
                  type="number" min={0} max={draft.type === 'percentage' ? 100 : undefined}
                  value={draft.value || ''} onChange={(e) => set({ value: Number(e.target.value) })}
                  data-testid="create-offer-value-input"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-[var(--brand-color)]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Minimum order</label>
                <div className="flex items-center border border-[var(--color-border-input)] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-200">
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
                  <div className="flex items-center border border-[var(--color-border-input)] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-200">
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
                    draft.scope === s ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'
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
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${on ? 'bg-[var(--color-blue-600-solid)] text-white border-blue-600' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}
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
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${on ? 'bg-[var(--color-blue-600-solid)] text-white border-blue-600' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}
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

          {/* Offer banner image (optional) — travels with the offer as imageUrl */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Banner image · optional</label>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOfferImage(f); e.target.value = ''; }}
            />
            {draft.imageUrl ? (
              <div className="flex items-center gap-3">
                <img src={draft.imageUrl} alt="Offer banner" className="w-28 h-[70px] object-cover rounded-xl border border-gray-200" />
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => imageRef.current?.click()} className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                    <ImageIcon className="w-3.5 h-3.5" /> Replace image
                  </button>
                  <button onClick={() => set({ imageUrl: '' })} className="flex items-center gap-1.5 text-[11px] font-bold text-red-500 hover:text-red-600 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" /> Remove image
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => imageRef.current?.click()} className="flex items-center gap-1.5 text-xs font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" /> {imageUploading ? 'Uploading…' : 'Upload a banner image'}
              </button>
            )}
            <p className="text-[10px] text-gray-400 mt-1.5">A banner for this offer, shown on the offer and reusable in the Promotion Studio.</p>
          </div>
        </div>
      )}

      {/* STEP 2 — Audience */}
      {step === 2 && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-800">Who should get this offer?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
              {AUDIENCE_OPTIONS.map((a: AudienceOption) => {
                const on = draft.audienceChoice === a.id;
                return (
                  <button
                    key={a.id} onClick={() => set({ audienceChoice: a.id })}
                    className={`text-left border rounded-2xl p-3.5 transition-all cursor-pointer ${on ? 'border-[var(--brand-color)] bg-blue-50/40 ring-2 ring-blue-100' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-[var(--brand-color)]/40'}`}
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
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${draft.tier === t ? 'bg-[var(--color-amber-500-solid)] text-white border-amber-500' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}>
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
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${on ? 'bg-[var(--color-indigo-600-solid)] text-white border-indigo-600' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}>
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

          {/* Where should this offer run? — only for multi-branch restaurants */}
          {branches.filter((b) => b.isActive !== false).length > 1 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-bold text-gray-800">Where should this offer run?</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => set({ branchIds: [] })}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${draft.branchIds.length === 0 ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}
                >
                  All branches
                </button>
                {branches.filter((b) => b.isActive !== false).map((b) => {
                  const on = draft.branchIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => set({ branchIds: on ? draft.branchIds.filter((x) => x !== b.id) : [...draft.branchIds, b.id] })}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${on ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
              {draft.branchIds.length > 0 && (
                <p className="text-[11px] text-gray-400 mt-2">This offer will only be available at the selected {draft.branchIds.length === 1 ? 'branch' : 'branches'}.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 3 — Schedule */}
      {step === 3 && (
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-800">When should this offer run?</p>
            <div className="flex gap-2 mt-3">
              {(['now', 'schedule'] as const).map((m) => (
                <button key={m} onClick={() => set({ runMode: m })}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${draft.runMode === m ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}>
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
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Ends</label>
                <input type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Publish date (when it goes live)</label>
                <input type="date" value={draft.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
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
                        className={`w-10 py-2 rounded-xl text-[11px] font-black cursor-pointer ${on ? 'bg-[var(--brand-color)] text-white' : 'bg-[var(--color-bg-white)] border border-gray-200 text-gray-500'}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Between</label>
                  <select value={draft.startHour} onChange={(e) => set({ startHour: e.target.value })} className="px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  <span className="text-gray-400 text-xs">and</span>
                  <select value={draft.endHour} onChange={(e) => set({ endHour: e.target.value })} className="px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
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
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-6">
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
                    className={`text-left border rounded-2xl p-3.5 transition-all cursor-pointer ${on ? 'border-[var(--brand-color)] bg-blue-50/40 ring-2 ring-blue-100' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-[var(--brand-color)]/40'}`}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Tone</label>
                  <select value={draft.copyTone} onChange={(e) => set({ copyTone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                    {COPY_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Language</label>
                  <select value={draft.copyLanguage} onChange={(e) => set({ copyLanguage: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                    {COPY_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>
              <textarea value={draft.message} onChange={(e) => set({ message: e.target.value })} rows={3}
                placeholder="e.g. 🎉 Weekend Special! Get 20% OFF orders above ₹499 this Saturday & Sunday."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
              {draft.channels.email && (
                <div className="grid grid-cols-1 gap-3">
                  <input value={draft.emailSubject} onChange={(e) => set({ emailSubject: e.target.value })} placeholder="Email subject"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <textarea value={draft.emailBody} onChange={(e) => set({ emailBody: e.target.value })} rows={3} placeholder="Email body"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
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
                  className="w-48 px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-black font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <button onClick={() => set({ couponCode: generateCoupon() })}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--color-bg-white)] border border-gray-200 text-xs font-bold text-gray-600 hover:border-[var(--brand-color)] cursor-pointer">
                  <RefreshCw className="w-3.5 h-3.5" /> Generate code
                </button>
              </div>
            )}
            {draft.couponEnabled && <p className="text-[10px] text-gray-400 mt-2">Customers can enter this code at checkout. It must be unique for your restaurant.</p>}
          </div>
        </div>
      )}

      {/* STEP 5 — Studio: design the banner, or use a whole image as-is */}
      {step === 5 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* LEFT — design controls */}
          <div className="space-y-4">
            {/* 1 · Design mode */}
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">1 · Design mode</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreative((c) => ({ ...c, templateId: c.templateId === 'full-image' ? 'hero-banner' : c.templateId }))}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer ${creative.templateId !== 'full-image' ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'}`}
                >
                  🎨 Design a banner
                </button>
                <button
                  type="button"
                  onClick={() => setCreative((c) => ({ ...c, templateId: 'full-image' }))}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer ${creative.templateId === 'full-image' ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'}`}
                >
                  🖼️ Use a whole image
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-2.5">
                {creative.templateId === 'full-image'
                  ? 'Upload your own finished design — it fills the whole banner exactly as you made it.'
                  : 'Pick a template, add your image and text, and the banner updates live.'}
              </p>
            </div>

            {creative.templateId === 'full-image' ? (
              /* ── Whole image mode ── */
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">2 · Your image</p>
                <input ref={studioImageRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadStudioImage(f); e.target.value = ''; }} />
                {creative.imageUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={creative.imageUrl} alt="Whole image" className="w-40 h-24 object-cover rounded-xl border border-gray-200" />
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => studioImageRef.current?.click()} className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                        <ImageIcon className="w-3.5 h-3.5" /> Replace image
                      </button>
                      <button onClick={() => setCreative((c) => ({ ...c, imageUrl: null }))} className="flex items-center gap-1.5 text-[11px] font-bold text-red-500 hover:text-red-600 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" /> Remove image
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => studioImageRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-2xl py-10 text-gray-500 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] hover:bg-blue-50/40 transition-all cursor-pointer"
                  >
                    {studioImageUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                    <span className="text-xs font-black">{studioImageUploading ? 'Uploading…' : 'Upload your finished design'}</span>
                    <span className="text-[10px] text-gray-400">PNG, JPG or WebP — the image becomes the whole banner</span>
                  </button>
                )}
                <div>
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Caption (optional)</label>
                  <input value={creative.title} onChange={(e) => setCreative((c) => ({ ...c, title: e.target.value }))} maxLength={80} placeholder="e.g. Diwali Special — 20% OFF" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>
              </div>
            ) : (
              /* ── Template design mode ── */
              <>
                {/* 2 · Template */}
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">2 · Template</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {PROMO_TEMPLATES.filter((t) => t.id !== 'full-image').map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCreative((c) => ({ ...c, templateId: t.id }))}
                        className={`text-left border rounded-xl p-3 transition-all cursor-pointer ${creative.templateId === t.id ? 'border-[var(--brand-color)] ring-2 ring-blue-100 bg-blue-50/40' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-[var(--brand-color)]/40'}`}
                      >
                        <span className="text-lg">{t.id === 'hero-banner' ? '🖼️' : t.id === 'offer-card' ? '🃏' : t.id === 'square-creative' ? '⬛' : '📱'}</span>
                        <p className="text-xs font-extrabold text-gray-800 mt-1">{t.name}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">{t.category}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3 · Image (optional) */}
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">3 · Image (optional)</p>
                    {creative.imageUrl && (
                      <button onClick={() => setCreative((c) => ({ ...c, imageUrl: null }))} className="flex items-center gap-1 text-[10px] font-bold text-red-500 hover:text-red-600 cursor-pointer">
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </div>
                  <input ref={studioImageRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadStudioImage(f); e.target.value = ''; }} />
                  <div className="flex flex-wrap items-center gap-2">
                    {draft.imageUrl && (
                      <button
                        type="button"
                        onClick={() => setCreative((c) => ({ ...c, imageUrl: draft.imageUrl }))}
                        className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${creative.imageUrl === draft.imageUrl ? 'border-[var(--brand-color)] ring-2 ring-blue-100' : 'border-transparent hover:border-gray-300'}`}
                        title="Offer banner image"
                      >
                        <img src={draft.imageUrl} alt="Offer banner" className="w-full h-full object-cover" />
                      </button>
                    )}
                    {creative.imageUrl && (
                      <button
                        type="button"
                        onClick={() => studioImageRef.current?.click()}
                        className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${creative.imageUrl !== draft.imageUrl ? 'border-[var(--brand-color)] ring-2 ring-blue-100' : 'border-transparent hover:border-gray-300'}`}
                        title="Uploaded image"
                      >
                        <img src={creative.imageUrl} alt="Uploaded" className="w-full h-full object-cover" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => studioImageRef.current?.click()}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-[var(--brand-color)] hover:border-[var(--brand-color)] hover:bg-blue-50/40 transition-all cursor-pointer"
                    >
                      {studioImageUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                      {studioImageUploading ? 'Uploading…' : 'Upload image'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400">Use your offer banner image or upload a new one. No image? The template still looks great with your colors.</p>
                </div>

                {/* 4 · Copy */}
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-2.5">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">4 · Text</p>
                  <div>
                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Title</label>
                    <input value={creative.title} onChange={(e) => setCreative((c) => ({ ...c, title: e.target.value }))} maxLength={80} placeholder="e.g. Weekend Burger Treat" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Subtitle</label>
                    <input value={creative.subtitle} onChange={(e) => setCreative((c) => ({ ...c, subtitle: e.target.value }))} maxLength={140} placeholder="e.g. On orders above ₹499" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Description</label>
                    <textarea value={creative.description} onChange={(e) => setCreative((c) => ({ ...c, description: e.target.value }))} rows={2} maxLength={400} placeholder="What's the offer about?" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">CTA button</label>
                    <input value={creative.cta} onChange={(e) => setCreative((c) => ({ ...c, cta: e.target.value }))} maxLength={40} placeholder="Order Now" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                </div>

                {/* 5 · Colors */}
                <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-input)] p-5">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">5 · Colors</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Background</label>
                      <div className="flex items-center gap-1.5 border border-[var(--color-border-input)] rounded-xl p-1.5">
                        <input type="color" value={creative.colors.background} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, background: e.target.value } }))} className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent" />
                        <input value={creative.colors.background} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, background: e.target.value } }))} maxLength={7} className="w-full text-xs font-bold focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Text</label>
                      <div className="flex items-center gap-1.5 border border-[var(--color-border-input)] rounded-xl p-1.5">
                        <input type="color" value={creative.colors.text} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, text: e.target.value } }))} className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent" />
                        <input value={creative.colors.text} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, text: e.target.value } }))} maxLength={7} className="w-full text-xs font-bold focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Accent</label>
                      <div className="flex items-center gap-1.5 border border-[var(--color-border-input)] rounded-xl p-1.5">
                        <input type="color" value={creative.colors.accent} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, accent: e.target.value } }))} className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent" />
                        <input value={creative.colors.accent} onChange={(e) => setCreative((c) => ({ ...c, colors: { ...c.colors, accent: e.target.value } }))} maxLength={7} className="w-full text-xs font-bold focus:outline-none" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* RIGHT — live preview */}
          <div className="space-y-4 lg:sticky lg:top-0">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-gray-400" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Live preview</p>
            </div>
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <PromotionCreative
                creative={{ ...creative, language: draft.copyLanguage || 'en', tone: draft.copyTone || 'friendly', image: creative.imageUrl ? { key: creative.imageUrl, source: 'uploaded' } : null }}
                templateId={creative.templateId}
                discountLabel={offerValueLabel(draft.type, draft.value, currencySymbol)}
              />
            </div>
            <p className="text-[10px] text-gray-400">
              Shown on your customer website &amp; QR ordering. The discount always comes from the live offer.
            </p>
          </div>
        </div>
      )}

      {/* STEP 6 — Preview (final check before saving) */}
      {step === 6 && (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><Eye className="w-4 h-4" /> Customer preview</p>
              <AiTag />
            </div>
            <PromotionPreview draft={draft} currencySymbol={currencySymbol} audienceSize={audienceSize} />
          </div>

          {creativeTouched && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Your banner</p>
                <button onClick={() => setStep(5)} className="flex items-center gap-1 text-[10px] font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                  <Palette className="w-3 h-3" /> Back to Studio
                </button>
              </div>
              <PromotionCreative
                creative={{ ...creative, language: draft.copyLanguage || 'en', tone: draft.copyTone || 'friendly', image: creative.imageUrl ? { key: creative.imageUrl, source: 'uploaded' } : null }}
                templateId={creative.templateId}
                discountLabel={offerValueLabel(draft.type, draft.value, currencySymbol)}
              />
            </div>
          )}

          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 space-y-3">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Promotion summary</p>
            <SummaryRow icon={<Percent className="w-3.5 h-3.5" />} label="Offer" value={`${OFFER_TYPE_LABELS[draft.type]} · ${offerValueLabel(draft.type, draft.value, currencySymbol)}${draft.minOrderValue ? ` (min ${currencySymbol}${draft.minOrderValue})` : ''}`} />
            <SummaryRow icon={<Users className="w-3.5 h-3.5" />} label="Audience" value={draft.audienceChoice === 'tier' ? `${draft.tier} members` : AUDIENCE_OPTIONS.find((a) => a.id === draft.audienceChoice)?.label || 'Everyone'} />
            {branches.filter((b) => b.isActive !== false).length > 1 && (
              <SummaryRow icon={<Palette className="w-3.5 h-3.5" />} label="Branches" value={draft.branchIds.length === 0 ? 'All branches' : draft.branchIds.map((id) => branches.find((b) => b.id === id)?.name || 'Branch').join(', ')} />
            )}
            <SummaryRow icon={<CalendarClock className="w-3.5 h-3.5" />} label="Schedule" value={draft.runMode === 'now' ? 'Starts immediately' : `${draft.startDate || '—'} → ${draft.endDate || 'no end date'}${draft.repeatWeekly && draft.daysOfWeek.length ? ` · ${draft.daysOfWeek.map((d) => DAYS[d]).join(', ')}` : ''}`} />
            <SummaryRow icon={<Send className="w-3.5 h-3.5" />} label="Channels" value={Object.entries(draft.channels).filter(([, v]) => v).map(([k]) => k === 'push' ? 'Push' : k === 'checkout' ? 'Checkout' : k === 'website' ? 'Website' : k).join(' + ') || '—'} />
            {draft.couponEnabled && <SummaryRow icon={<Tag className="w-3.5 h-3.5" />} label="Coupon" value={draft.couponCode} mono />}
          </div>
        </div>
      )}

      {/* Footer nav — the Goal step has no footer: picking a goal advances
          automatically, so the old "Next" (and "Cancel" in the header) were
          redundant there. Later steps keep Back/Next to move through the form. */}
      {!saved && step > 0 && (
      <div className="flex items-center justify-between gap-3 pt-2">
        <button onClick={() => setStep(step - 1)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        {step < STEP_LABELS.length - 1 ? (
          <button onClick={() => canNext() && setStep(step + 1)} disabled={!canNext()}
            className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
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
                className="flex items-center gap-1.5 bg-[var(--color-amber-500-solid)] hover:bg-[var(--color-amber-600-solid)] text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-50">
                <CalendarClock className="w-3.5 h-3.5" /> Schedule Offer
              </button>
            ) : (
              <button onClick={() => saveOffer('active')} disabled={saving}
                className="flex items-center gap-1.5 bg-[var(--color-green-600-solid)] hover:bg-[var(--color-green-700-solid)] text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} {editingId ? 'Save & Activate' : 'Activate Offer'}
              </button>
            )}
          </div>
        )}
        </div>
      )}
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

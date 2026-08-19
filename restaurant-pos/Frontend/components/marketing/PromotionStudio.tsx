/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionStudio — the Phase C Promotion Studio. Turns an existing offer
 * into a branded, customer-ready promotion in seconds.
 *
 * Workflow: SELECT (offer) → GENERATE (image/template) → CUSTOMIZE (copy,
 * colors, logo, CTA) → PREVIEW (desktop/mobile/QR) → SAVE DRAFT / PUBLISH.
 *
 * Rules honored:
 *   - The Offer is the financial source of truth. The studio never stores or
 *     invents prices — the authoritative discount comes from the live offer,
 *     and a mismatch banner appears when the offer changed after the creative
 *     was generated.
 *   - AI copy is advisory (sanitized context; fallback is deterministic).
 *   - Publishing requires the linked offer to be live (server-enforced).
 *   - Drafts, published and archived promotions are listed in the library.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Wand2, Loader2, Save, Send, Copy, Archive, RotateCcw, ImagePlus,
  CheckCircle, Sparkles, Trash2, Layers, Eye, Type,
} from 'lucide-react';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import RefreshButton from '../common/RefreshButton';
import { offerValueLabel, fmtNumber, EmptyState, AiTag } from './shared';
import { PROMO_TEMPLATES, templateById } from './promotionTemplates';
import PromotionCreative from './PromotionCreative';

interface PromotionStudioProps {
  currencySymbol: string;
  offers: any[];
  products: any[];
  initialOfferId?: string | null;
  restaurantName?: string;
  onDone: (msg: string) => void;
  onBack: () => void;
}

interface CreativeState {
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  language: string;
  tone: string;
  colors: { background: string; text: string; accent: string };
  image: { key?: string; source?: string } | null;
  /** Per-screen image overrides — absent key = screen uses the shared `image`. */
  screenImages: Record<string, { key: string; source: string }>;
  logoKey: string | null;
  productImageKeys: string[];
  layout: string;
}

// The screens the creative renders on. Each maps to a template + live preview.
const SCREENS = [
  { id: 'hero-banner', label: 'Website banner', hint: 'Top of your customer website', emoji: '🖥️' },
  { id: 'offer-card', label: 'Offer card', hint: 'Compact card next to menu items', emoji: '🃏' },
  { id: 'square-creative', label: 'Social / WhatsApp', hint: 'WhatsApp status & social posts', emoji: '📱' },
  { id: 'mobile-banner', label: 'QR ordering', hint: 'Top of the QR ordering screen', emoji: '🧾' },
] as const;

interface PromotionDoc {
  _id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  offerId: string;
  templateId: string;
  channels: string[];
  creative: CreativeState;
  offer?: any;
  publishedAt?: string;
}

const TONES = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'funky', label: 'Funky' },
  { id: 'zomato', label: 'Zomato style' },
  { id: 'professional', label: 'Professional' },
  { id: 'premium', label: 'Premium' },
  { id: 'festive', label: 'Festive' },
  { id: 'genz', label: 'Gen Z' },
  { id: 'minimal', label: 'Minimal' },
];

const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'hinglish', label: 'Hinglish' },
];

const LENGTHS = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
};

function emptyCreative(): CreativeState {
  return {
    title: '', subtitle: '', description: '', cta: 'Order Now',
    language: 'en', tone: 'friendly',
    colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
    image: null, screenImages: {}, logoKey: null, productImageKeys: [], layout: 'hero-banner',
  };
}

export default function PromotionStudio({ currencySymbol, offers, products, initialOfferId, restaurantName, onDone, onBack }: PromotionStudioProps) {
  const [view, setView] = useState<'library' | 'editor'>('library');
  const [list, setList] = useState<PromotionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [promo, setPromo] = useState<PromotionDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [offerId, setOfferId] = useState<string>('');
  const [creative, setCreative] = useState<CreativeState>(emptyCreative());
  const [templateId, setTemplateId] = useState('hero-banner');
  const [channels, setChannels] = useState<string[]>(['website']);
  const [name, setName] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mismatch, setMismatch] = useState<{ mismatched: boolean; reason?: string }>({ mismatched: false });
  const [offerImages, setOfferImages] = useState<{ id: string; name: string; image: string | null }[]>([]);
  const [branding, setBranding] = useState<{ name: string; logoUrl: string | null; coverImageUrl: string | null }>({
    name: restaurantName || '', logoUrl: null, coverImageUrl: null,
  });
  const [productImages, setProductImages] = useState<{ id: string; name: string; image: string | null }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // When a per-screen Upload is clicked, this holds which screen the next
  // chosen file belongs to (null = the shared/primary image).
  const pendingScreenRef = useRef<string | null>(null);
  const [filter, setFilter] = useState('all');

  const selectedOffer = useMemo(() => offers.find((o) => o._id === offerId) || null, [offers, offerId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.fetchPromotions({ status: filter === 'all' ? 'all' : filter, limit: 100 });
      setList(res?.promotions || []);
    } catch (err) {
      debugWarn('PromotionStudio', 'load failed', err);
      setError('Could not load promotions. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    reload();
    api.fetchRestaurantBranding?.().then((b: any) => {
      if (b) setBranding({ name: b.name || restaurantName || '', logoUrl: b.logoUrl, coverImageUrl: b.coverImageUrl });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // ─── Entry: open the studio on a specific offer (PATH A / B / C) ──
  useEffect(() => {
    if (initialOfferId) startNew(initialOfferId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOfferId]);

  const startNew = async (id: string) => {
    let offer = offers.find((o) => o._id === id);
    // Race condition: after creating an offer, data.refresh() fires but the
    // React state update may not have committed by the time the Studio mounts.
    // Fetch the offer directly from the API so the Studio always loads.
    if (!offer) {
      try {
        const res = await api.fetchOfferList();
        const list = res?.offers || [];
        offer = list.find((o: any) => o._id === id) || null;
        // Also refresh the parent's offers array so subsequent interactions
        // don't hit the same race condition.
        if (offer && list.length > 0) {
          // Best-effort: replace offers via the onDone callback signal is not
          // available here, so just use the fetched data for this session.
        }
      } catch { /* ignore — will show error below */ }
    }
    if (!offer) { setError('Offer not found.'); return; }
    setOfferId(id);
    setTemplateId('hero-banner');
    setChannels(['website']);
    setCreative(emptyCreative());
    setName(offer.title || `${offerValueLabel(offer.type, offer.value, currencySymbol)} promotion`);
    setPromo(null);
    setEditing(false);
    setMismatch({ mismatched: false });
    setNotice('');
    setError('');
    // Auto-suggest creative from the offer (deterministic, no AI needed).
    const suggested = suggestedCreative(offer);
    setCreative(suggested.creative);
    setName(suggested.name);
    // Load product images for the offer.
    try {
      const imgRes = await api.fetchOfferProductImages(id);
      const imgs = imgRes?.images || [];
      setOfferImages(imgs);
      const withImg = imgs.filter((i: any) => i.image);
      if (withImg.length > 0) {
        const first = withImg[0];
        // Only use the product image as a fallback when no banner image was
        // already set (from the offer's imageUrl uploaded in CreatePromotion).
        setCreative((c) => ({
          ...c,
          image: c.image?.key ? c.image : { key: first.image, source: 'product' },
          productImageKeys: [first.image],
        }));
      }
    } catch (err) {
      debugWarn('PromotionStudio', 'offer images failed', err);
    }
    setView('editor');
  };

  const suggestedCreative = (offer: any) => {
    const discount = offerValueLabel(offer.type, offer.value, currencySymbol);
    const minOrder = offer.minOrderValue ? `on orders above ${currencySymbol}${fmtNumber(offer.minOrderValue)}` : '';
    const title = offer.title || `${discount} promotion`;
    const subtitle = offer.shortDescription || (minOrder ? minOrder : 'Limited time offer');
    const description = offer.description || `Get ${discount}${minOrder ? ` ${minOrder}` : ''}. Order now and treat yourself!`;
    const cta = offer.type === 'combo' ? 'Order Combo' : 'Order Now';
    // If the offer already has a banner image (uploaded in CreatePromotion),
    // carry it into the Studio so the merchant sees and can edit it.
    const bannerImage = offer.imageUrl ? { key: offer.imageUrl, source: 'uploaded' as const } : null;
    return {
      name: `${title} — Creative`,
      creative: { ...emptyCreative(), title, subtitle, description, cta, image: bannerImage },
    };
  };

  const applySuggestion = () => {
    if (!selectedOffer) return;
    const s = suggestedCreative(selectedOffer);
    setCreative((c) => ({ ...c, ...s.creative }));
    setName(s.name);
    setNotice('Creative reset to the suggested version.');
    setError('');
  };

  const generateCopy = async () => {
    if (!selectedOffer) return;
    setAiBusy(true);
    setError('');
    try {
      const res = await api.generatePromotionCopy({
        offerId,
        restaurantName: branding.name || restaurantName || undefined,
        offerTitle: selectedOffer.title,
        offerType: selectedOffer.type,
        discountValue: offerValueLabel(selectedOffer.type, selectedOffer.value, currencySymbol),
        minOrderValue: selectedOffer.minOrderValue,
        productNames: offerImages.map((i) => i.name).slice(0, 8),
        validUntil: selectedOffer.endDate,
        language: creative.language,
        tone: creative.tone,
        length: 'short',
      });
      const data = res?.data || res;
      if (data) {
        setCreative((c) => ({
          ...c,
          title: data.title || c.title,
          subtitle: data.subtitle || c.subtitle,
          description: data.description || c.description,
          cta: data.cta || c.cta,
        }));
        setNotice(data.fallback ? 'AI is unavailable — using a suggested copy. You can edit it.' : 'AI wrote new copy. Edit anything you like.');
      }
    } catch (err) {
      debugWarn('PromotionStudio', 'AI copy failed', err);
      setError('AI copy is unavailable right now — the suggested copy is still there.');
    } finally {
      setAiBusy(false);
    }
  };

  const uploadImage = async (file: File, screenId?: string) => {
    setError('');
    try {
      const result = await api.uploadPromotionMedia(file, { source: 'uploaded', offerId: offerId || undefined });
      if (!result?.url) { setError('Image upload failed. Try a smaller image (JPG/PNG/WebP).'); return; }
      if (screenId) {
        setCreative((c) => ({ ...c, screenImages: { ...(c.screenImages || {}), [screenId]: { key: result.url, source: 'uploaded' } } }));
        setNotice(`Image uploaded for “${SCREENS.find((s) => s.id === screenId)?.label || screenId}” — other screens keep their own image.`);
      } else {
        setCreative((c) => ({ ...c, image: { key: result.url, source: 'uploaded' } }));
        setNotice('Image uploaded and shared across every screen. Customize any screen below for a different look.');
      }
    } catch (err) {
      debugWarn('PromotionStudio', 'upload failed', err);
      setError('Image upload failed. Check your connection and try again.');
    }
  };

  /** Resolve the effective image for a screen: override, else the shared one. */
  const creativeForScreen = (screenId: string): CreativeState => ({
    ...creative,
    image: creative.screenImages?.[screenId] ?? creative.image,
  });

  const clearScreenImage = (screenId: string) => {
    setCreative((c) => {
      const next = { ...(c.screenImages || {}) };
      delete next[screenId];
      return { ...c, screenImages: next };
    });
    setNotice('This screen now uses the shared image.');
  };

  const applyPrimaryToAll = () => {
    setCreative((c) => ({ ...c, screenImages: {} }));
    setNotice('Same image applied to all screens — upload a new shared image to change every screen at once.');
  };

  const setImageFromProduct = (image: string | null) => {
    setCreative((c) => ({ ...c, image: image ? { key: image, source: 'product' } : null }));
  };

  const setLogoFromBranding = () => {
    setCreative((c) => ({ ...c, logoKey: branding.logoUrl }));
    setNotice('Using your restaurant logo.');
  };

  const save = async (status: 'draft' | 'published') => {
    setSaving(true);
    setError('');
    try {
      if (!offerId) { setError('Pick an offer first.'); setSaving(false); return; }
      const body = {
        offerId,
        name: name.trim() || 'Promotion',
        channels,
        templateId,
        creative: { ...creative, templateId, layout: templateId },
        generatedBy: 'manual',
      };
      let saved: any;
      if (promo && editing) {
        // PATCH schema is strict — it accepts name/channels/templateId/creative only.
        const { offerId: _oid, generatedBy: _gen, ...patchBody } = body;
        saved = await api.updatePromotion(promo._id, patchBody);
      } else {
        saved = await api.createPromotion(body);
      }
      if (!saved) { setError('Could not save. Check your connection and try again.'); return; }
      if (status === 'published') {
        try {
          saved = await api.publishPromotion(saved._id || saved.id);
        } catch (err: any) {
          setError(err?.message || 'The linked offer is not live — activate it first, then publish.');
          await reload();
          setSaving(false);
          return;
        }
      }
      onDone(status === 'published' ? 'Promotion published' : 'Draft saved');
      setView('library');
      setPromo(null);
      setEditing(false);
      await reload();
    } catch (err: any) {
      debugWarn('PromotionStudio', 'save failed', err);
      setError(err?.message || 'Could not save the promotion.');
    } finally {
      setSaving(false);
    }
  };

  const editPromo = async (p: PromotionDoc) => {
    setPromo(p);
    setEditing(true);
    setOfferId(p.offerId);
    setTemplateId(p.templateId || 'hero-banner');
    setChannels(p.channels?.length ? p.channels : ['website']);
    setName(p.name);
    setCreative({ ...emptyCreative(), ...p.creative, layout: p.templateId || 'hero-banner' });
    setError('');
    setNotice('');
    try {
      const check = await api.checkPromotionMismatch(p._id);
      setMismatch(check || { mismatched: false });
    } catch (err) {
      setMismatch({ mismatched: false });
    }
    try {
      const imgRes = await api.fetchOfferProductImages(p.offerId);
      setOfferImages(imgRes?.images || []);
    } catch { /* ignore */ }
    setView('editor');
  };

  const duplicate = async (p: PromotionDoc) => {
    try {
      const copy = await api.duplicatePromotion(p._id);
      if (copy) { onDone('Promotion duplicated as a draft'); await reload(); }
    } catch (err) {
      debugWarn('PromotionStudio', 'duplicate failed', err);
      setError('Could not duplicate. Try again.');
    }
  };

  const archive = async (p: PromotionDoc) => {
    try {
      await api.archivePromotion(p._id);
      onDone('Promotion archived');
      await reload();
    } catch (err) {
      debugWarn('PromotionStudio', 'archive failed', err);
      setError('Could not archive. Try again.');
    }
  };

  const restore = async (p: PromotionDoc) => {
    try {
      await api.restorePromotion(p._id);
      onDone('Promotion restored to drafts');
      await reload();
    } catch (err) {
      debugWarn('PromotionStudio', 'restore failed', err);
      setError('Could not restore. Try again.');
    }
  };

  const refreshSnapshot = async () => {
    // Re-publish refreshes the offerSnapshot server-side; simplest path here.
    if (!promo) return;
    try {
      const updated = await api.updatePromotion(promo._id, {});
      if (updated) {
        const check = await api.checkPromotionMismatch(promo._id);
        setMismatch(check || { mismatched: false });
        setNotice(check?.mismatched ? 'Creative is still stale — the offer changed.' : 'Creative is up to date.');
      }
    } catch (err) {
      debugWarn('PromotionStudio', 'refresh failed', err);
    }
  };

  const canPublish = !!selectedOffer && (selectedOffer.status === 'active' || selectedOffer.status === 'scheduled');

  // ─── Library view ──────────────────────────────────────────────
  if (view === 'library') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Promotion Studio</p>
            <h3 className="text-sm font-extrabold text-gray-900">Promotions</h3>
            <p className="text-[11px] text-gray-400 mt-1">Turn an offer into a branded creative — or pick one to edit.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={filter} onChange={(e) => { setFilter(e.target.value); }} className="px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
              <option value="all">All</option>
              <option value="draft">Drafts</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <button onClick={() => { setPromo(null); setEditing(false); setView('editor'); setError(''); }}
              className="flex items-center gap-1.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer">
              <Sparkles className="w-3.5 h-3.5" /> New Promotion
            </button>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-3">{error}</div>}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-52 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon="🎨"
            title="No promotions yet"
            subtitle="Pick an offer and turn it into a branded banner or card your customers can see."
            cta={<button onClick={() => { setPromo(null); setEditing(false); setView('editor'); setError(''); }} className="flex items-center gap-1.5 bg-[var(--brand-color)] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"><Sparkles className="w-3.5 h-3.5" /> Create Promotion</button>}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((p) => (
              <PromotionCard
                key={p._id}
                promo={p}
                currencySymbol={currencySymbol}
                onEdit={() => editPromo(p)}
                onDuplicate={() => duplicate(p)}
                onArchive={() => archive(p)}
                onRestore={() => restore(p)}
                onPublish={() => { editPromo(p).then(() => save('published')); }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Editor view ───────────────────────────────────────────────
  const discountLabel = selectedOffer ? offerValueLabel(selectedOffer.type, selectedOffer.value, currencySymbol) : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setView('library'); setError(''); }} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] rounded-lg transition-colors cursor-pointer" title="Back to library">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Promotion Studio</p>
            <h3 className="text-sm font-extrabold text-gray-900">{editing ? 'Edit Promotion' : 'Create Promotion'}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={applySuggestion} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to Suggested
          </button>
          <button onClick={() => save('draft')} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {editing ? 'Save Changes' : 'Save Draft'}
          </button>
          <button onClick={() => save('published')} disabled={saving || !canPublish} title={!canPublish ? 'Activate the linked offer before publishing' : ''}
            className="flex items-center gap-1.5 bg-[var(--color-green-600-solid)] hover:bg-[var(--color-green-700-solid)] text-white px-5 py-2 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Publish
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-3">{error}</div>}
      {notice && <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold rounded-xl px-4 py-3">{notice}</div>}
      {mismatch.mismatched && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span>⚠ {mismatch.reason || 'The linked offer changed after this creative was made.'}</span>
          <RefreshButton onRefresh={refreshSnapshot} className="gap-1.5 text-amber-700 underline font-bold whitespace-nowrap" iconClassName="w-3 h-3">
            Refresh
          </RefreshButton>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — controls */}
        <div className="space-y-5">
          {/* STEP 1 — Offer */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">1 · Offer</p>
            {editing ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-extrabold text-gray-800">{selectedOffer?.title || 'Offer'}</span>
                <span className="text-[10px] font-bold text-gray-400">{discountLabel}</span>
              </div>
            ) : (
              <select
                value={offerId}
                onChange={(e) => startNew(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200 bg-[var(--color-bg-white)]"
              >
                <option value="">Choose an offer…</option>
                {offers.map((o) => (
                  <option key={o._id} value={o._id}>
                    {o.title} — {offerValueLabel(o.type, o.value, currencySymbol)}{o.status === 'active' ? '' : ` (${o.status})`}
                  </option>
                ))}
              </select>
            )}
            {selectedOffer && (
              <div className="mt-2 text-[11px] text-gray-400">
                {canPublish
                  ? <span className="text-green-600 font-bold">Live offer — ready to publish.</span>
                  : <span className="text-amber-600 font-bold">This offer is {selectedOffer.status}. Activate it in Offers before publishing.</span>}
              </div>
            )}
          </div>

          {/* STEP 2 — Template */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">2 · Template</p>
            <div className="grid grid-cols-2 gap-2.5">
              {PROMO_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTemplateId(t.id); setCreative((c) => ({ ...c, templateId: t.id, layout: t.id })); }}
                  className={`text-left border rounded-xl p-3 transition-all cursor-pointer ${templateId === t.id ? 'border-[var(--brand-color)] ring-2 ring-blue-100 bg-blue-50/40' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-[var(--brand-color)]/40'}`}
                >
                  <span className="text-lg">{t.id === 'full-image' ? '🌄' : t.id === 'hero-banner' ? '🖼️' : t.id === 'offer-card' ? '🃏' : t.id === 'square-creative' ? '⬛' : '📱'}</span>
                  <p className="text-xs font-extrabold text-gray-800 mt-1">{t.name}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">{t.category}</p>
                </button>
              ))}
            </div>
          </div>

          {/* STEP 3 — Image + logo (shared image + per-screen overrides) */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">3 · Image</p>
              <button onClick={() => { pendingScreenRef.current = null; fileRef.current?.click(); }} className="flex items-center gap-1.5 text-xs font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                <ImagePlus className="w-3.5 h-3.5" /> Upload shared image
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; const sid = pendingScreenRef.current; pendingScreenRef.current = null; if (f) uploadImage(f, sid || undefined); e.target.value = ''; }} />
            </div>
            <p className="text-[11px] text-gray-500 mb-2">
              One shared image is used on every screen by default. Upload once, then give any screen its own image below.
            </p>
            <div className="flex flex-wrap gap-2">
              {branding.coverImageUrl && (
                <ImageChoice label="Restaurant" active={creative.image?.source === 'restaurant' || creative.image?.key === branding.coverImageUrl} onClick={() => setCreative((c) => ({ ...c, image: { key: branding.coverImageUrl!, source: 'restaurant' } }))} src={branding.coverImageUrl} />
              )}
              {offerImages.filter((i) => i.image).slice(0, 6).map((i) => (
                <ImageChoice key={i.id} label={i.name} active={creative.image?.key === i.image} onClick={() => setImageFromProduct(i.image)} src={i.image!} />
              ))}
              {(!branding.coverImageUrl && offerImages.filter((i) => i.image).length === 0) && (
                <p className="text-[11px] text-gray-400">No product images yet. Upload one, or use the template background.</p>
              )}
            </div>

            {/* Per-screen images — live mini previews */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Per-screen images</p>
                <button onClick={applyPrimaryToAll} className="flex items-center gap-1 text-[10px] font-bold text-[var(--brand-color)] hover:text-[var(--color-primary-hover)] cursor-pointer">
                  <Layers className="w-3 h-3" /> Same image on all screens
                </button>
              </div>
              <div className="space-y-2.5">
                {SCREENS.map((s) => {
                  const overridden = !!creative.screenImages?.[s.id];
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 p-2">
                      <div className="w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--color-bg-white)] border border-gray-100">
                        <PromotionCreative creative={creativeForScreen(s.id)} templateId={s.id} scale={0.26} showDiscount={false} restaurantName="" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-extrabold text-gray-800 flex items-center gap-1"><span>{s.emoji}</span> {s.label}</p>
                        <p className="text-[9px] text-gray-400 truncate">{s.hint}</p>
                        <p className={`text-[9px] font-bold mt-0.5 ${overridden ? 'text-[var(--brand-color)]' : 'text-gray-300'}`}>
                          {overridden ? '● Custom image for this screen' : '○ Uses the shared image'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => { pendingScreenRef.current = s.id; fileRef.current?.click(); }} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-gray-200 text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] bg-[var(--color-bg-white)] cursor-pointer">
                          <ImagePlus className="w-3 h-3 inline mr-0.5" /> Upload
                        </button>
                        {overridden && (
                          <button onClick={() => clearScreenImage(s.id)} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-gray-400 hover:text-gray-600 cursor-pointer" title="Use the shared image here instead">
                            Use shared
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Logo</p>
              <div className="flex items-center gap-2">
                {branding.logoUrl && (
                  <button onClick={setLogoFromBranding} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border cursor-pointer ${creative.logoKey ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-[var(--brand-color)]'}`}>
                    Use restaurant logo
                  </button>
                )}
                <button onClick={() => setCreative((c) => ({ ...c, logoKey: null }))} className="px-3 py-1.5 rounded-lg text-[10px] font-bold border border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-500 cursor-pointer">
                  No logo
                </button>
              </div>
            </div>
          </div>

          {/* STEP 4 — Copy */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">4 · Copy</p>
              <button onClick={generateCopy} disabled={aiBusy || !selectedOffer} className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 cursor-pointer disabled:opacity-60">
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} {aiBusy ? 'Writing…' : 'Generate with AI'}
              </button>
            </div>
            <div className="space-y-2.5">
              <Field label="Title">
                <input value={creative.title} onChange={(e) => setCreative((c) => ({ ...c, title: e.target.value }))} maxLength={80} placeholder="e.g. Weekend Burger Treat" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </Field>
              <Field label="Subtitle">
                <input value={creative.subtitle} onChange={(e) => setCreative((c) => ({ ...c, subtitle: e.target.value }))} maxLength={140} placeholder="e.g. On orders above ₹499" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </Field>
              <Field label="Description">
                <textarea value={creative.description} onChange={(e) => setCreative((c) => ({ ...c, description: e.target.value }))} rows={2} maxLength={400} placeholder="What's the offer about?" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
              </Field>
              <Field label="CTA button">
                <input value={creative.cta} onChange={(e) => setCreative((c) => ({ ...c, cta: e.target.value }))} maxLength={40} placeholder="Order Now" className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </Field>
            </div>

            {/* Tone / language / length */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Tone</label>
                <select value={creative.tone} onChange={(e) => setCreative((c) => ({ ...c, tone: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                  {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Language</label>
                <select value={creative.language} onChange={(e) => setCreative((c) => ({ ...c, language: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Length</label>
                <select value="short" onChange={(e) => { /* length used at generation time */ }} className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-bold bg-[var(--color-bg-white)]">
                  {LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* STEP 5 — Colors + channels (advanced, kept simple) */}
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">5 · Branding & channels</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <ColorField label="Background" value={creative.colors.background} onChange={(v) => setCreative((c) => ({ ...c, colors: { ...c.colors, background: v } }))} />
              <ColorField label="Text" value={creative.colors.text} onChange={(v) => setCreative((c) => ({ ...c, colors: { ...c.colors, text: v } }))} />
              <ColorField label="Accent" value={creative.colors.accent} onChange={(v) => setCreative((c) => ({ ...c, colors: { ...c.colors, accent: v } }))} />
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Show on</p>
              <div className="flex flex-wrap gap-2">
                {[['website', 'Customer website'], ['qr', 'QR ordering']].map(([id, label]) => {
                  const on = channels.includes(id);
                  return (
                    <button key={id} onClick={() => setChannels(on ? channels.filter((c) => c !== id) : [...channels, id])}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${on ? 'bg-[var(--color-blue-600-solid)] text-white border-blue-600' : 'bg-[var(--color-bg-white)] border-gray-200 text-gray-600'}`}>
                      {on ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — live preview (image in context on every screen) */}
        <div className="space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="w-4 h-4 text-gray-400" />
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Live preview — image on each screen</p>
            <AiTag />
          </div>
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">🖥️ Website banner</p>
              {creative.screenImages?.['hero-banner'] && <span className="text-[9px] font-bold text-[var(--brand-color)]">custom image</span>}
            </div>
            <PromotionCreative creative={creativeForScreen('hero-banner')} templateId="hero-banner" discountLabel={discountLabel} restaurantName={branding.name} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">🧾 QR ordering</p>
                {creative.screenImages?.['mobile-banner'] && <span className="text-[9px] font-bold text-[var(--brand-color)]">custom</span>}
              </div>
              <div className="mx-auto max-w-[180px]">
                <PromotionCreative creative={creativeForScreen('mobile-banner')} templateId="mobile-banner" discountLabel={discountLabel} restaurantName={branding.name} scale={0.8} />
              </div>
            </div>
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">🃏 Offer card</p>
                {creative.screenImages?.['offer-card'] && <span className="text-[9px] font-bold text-[var(--brand-color)]">custom</span>}
              </div>
              <PromotionCreative creative={creativeForScreen('offer-card')} templateId="offer-card" discountLabel={discountLabel} restaurantName={branding.name} scale={0.7} />
            </div>
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">📱 Social / WhatsApp</p>
                {creative.screenImages?.['square-creative'] && <span className="text-[9px] font-bold text-[var(--brand-color)]">custom</span>}
              </div>
              <div className="mx-auto max-w-[180px]">
                <PromotionCreative creative={creativeForScreen('square-creative')} templateId="square-creative" discountLabel={discountLabel} restaurantName={branding.name} scale={0.72} />
              </div>
            </div>
          </div>
          {selectedOffer && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-600 space-y-1">
              <p className="font-black text-gray-800 flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Offer summary</p>
              <p><strong>{selectedOffer.title}</strong> — {discountLabel}{selectedOffer.minOrderValue ? ` on orders above ${currencySymbol}${fmtNumber(selectedOffer.minOrderValue)}` : ''}</p>
              {selectedOffer.endDate && <p>Valid until {selectedOffer.endDate}</p>}
              <p className="text-[10px] text-gray-400">The discount shown always comes from the live offer — the creative never sets prices.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────

function PromotionCard({ promo, currencySymbol, onEdit, onDuplicate, onArchive, onRestore, onPublish }: {
  promo: PromotionDoc; currencySymbol: string;
  onEdit: () => void; onDuplicate: () => void; onArchive: () => void; onRestore: () => void; onPublish: () => void;
}) {
  const t = templateById(promo.templateId || 'hero-banner');
  const discount = promo.offer ? offerValueLabel(promo.offer.type, promo.offer.value, currencySymbol) : '';
  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden shadow-xs hover:shadow-md transition-all">
      <div className="p-3 bg-gray-50 border-b border-gray-100">
        <PromotionCreative creative={promo.creative} templateId={promo.templateId || 'hero-banner'} discountLabel={discount} restaurantName="" scale={0.6} />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-extrabold text-gray-900 truncate">{promo.name}</p>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 ${STATUS_STYLES[promo.status] || 'bg-gray-100 text-gray-500'}`}>{promo.status}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {promo.offer?.title || 'Offer'} · {t.name}
          {promo.channels?.length ? ` · ${promo.channels.map((c) => c === 'website' ? 'Website' : 'QR').join(' + ')}` : ''}
        </p>
        {promo.publishedAt && <p className="text-[10px] text-gray-400 mt-0.5">Published {new Date(promo.publishedAt).toLocaleDateString()}</p>}
        <div className="flex items-center gap-1.5 mt-3">
          <button onClick={onEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-[var(--brand-color)] hover:bg-blue-50 cursor-pointer">
            <Layers className="w-3 h-3" /> Edit
          </button>
          <button onClick={onDuplicate} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-gray-500 hover:bg-gray-100 cursor-pointer">
            <Copy className="w-3 h-3" /> Duplicate
          </button>
          {promo.status === 'published' ? (
            <button onClick={onArchive} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-amber-600 hover:bg-amber-50 cursor-pointer">
              <Archive className="w-3 h-3" /> Archive
            </button>
          ) : promo.status === 'archived' ? (
            <button onClick={onRestore} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-blue-50 cursor-pointer">
              <RotateCcw className="w-3 h-3" /> Restore
            </button>
          ) : (
            <button onClick={onPublish} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-green-600 hover:bg-green-50 cursor-pointer">
              <Send className="w-3 h-3" /> Publish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageChoice({ label, src, active, onClick }: { label: string; src: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label}
      className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${active ? 'border-[var(--brand-color)] ring-2 ring-blue-100' : 'border-transparent hover:border-gray-300'}`}>
      <img src={src} alt={label} className="w-full h-full object-cover" loading="lazy" />
      {active && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--brand-color)] text-white text-[8px] flex items-center justify-center font-black"><CheckCircle className="w-2.5 h-2.5" /></span>}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">{label}</label>
      <div className="flex items-center gap-1.5 border border-[var(--color-border-input)] rounded-xl p-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent" />
        <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="w-full text-xs font-bold focus:outline-none" />
      </div>
    </div>
  );
}

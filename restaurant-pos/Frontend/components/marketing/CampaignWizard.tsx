/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CampaignWizard — AI-assisted 5-step campaign builder.
 *
 * Step 1: Review Offer    — AI-prepared offer details, fully editable
 * Step 2: Branches        — Where the offer runs
 * Step 3: Marketing Studio — Creative, message, style, language, channels
 * Step 4: Schedule        — When the campaign goes live
 * Step 5: Review          — Summary + broadcast
 *
 * Mental model: AI prepares → Owner schedules → Owner reviews → Owner broadcasts.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Sparkles, Tag, Building, Palette,
  Send, Loader2, RefreshCw, Image as ImageIcon, Trash2, Megaphone,
  MessageCircle, Mail, Smartphone, Globe, Eye, Edit3, Wand2, X, Plus, Info,
  ChevronDown, ChevronUp, Copy, Check, CalendarDays, Clock, Save,
  Radio, Zap, Calendar,
} from 'lucide-react';
import type { Product, SystemSettings } from '../../src/types';
import * as api from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';

// ─── Types ────────────────────────────────────────────────────────

interface CampaignWizardProps {
  currencySymbol: string;
  products: Product[];
  branches: { id: string; name: string; isActive?: boolean }[];
  segments?: { id: string; name: string }[];
  settings?: SystemSettings;
  /** AI recommendation prefill (from advisor/recommendation cards). */
  prefill?: any;
  /** Called when wizard completes (offer + campaign created). */
  onDone: (offerId: string, campaignId: string) => void;
  /** Called to close the wizard. */
  onClose: () => void;
}

type StepKey = 'offer' | 'branches' | 'studio' | 'review' | 'schedule';

const STEPS: { key: StepKey; label: string; icon: React.ElementType }[] = [
  { key: 'offer', label: 'Offer', icon: Tag },
  { key: 'branches', label: 'Branches', icon: Building },
  { key: 'studio', label: 'Studio', icon: Palette },
  { key: 'schedule', label: 'Schedule', icon: Calendar },
  { key: 'review', label: 'Review', icon: Eye },
];

const OFFER_TYPES = [
  { value: 'percentage', label: '% Discount' },
  { value: 'flat', label: 'Flat ₹ Off' },
  { value: 'combo', label: 'Combo' },
  { value: 'bogo', label: 'Buy 1 Get 1' },
  { value: 'free_item', label: 'Free Item' },
  { value: 'cashback', label: 'Cashback' },
  { value: 'coupon', label: 'Coupon Code' },
];

const STYLES = [
  { value: 'auto', label: 'Auto', description: 'AI picks the best style' },
  { value: 'funky', label: 'Funky / Gen-Z', description: 'Young, energetic, emoji-heavy' },
  { value: 'friendly', label: 'Friendly', description: 'Warm, casual, inviting' },
  { value: 'professional', label: 'Professional', description: 'Clean, business-like' },
  { value: 'food_app', label: 'Food App Style', description: 'Like Swiggy/Zomato' },
  { value: 'promotional', label: 'Promotional', description: 'Bold, urgency-driven' },
  { value: 'premium', label: 'Premium', description: 'Upscale, refined' },
  { value: 'festive', label: 'Festive', description: 'Celebratory, seasonal' },
  { value: 'local', label: 'Local / Desi', description: 'Hinglish, colloquial' },
];

const LANGUAGES = [
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hi-en', label: 'Hinglish' },
];

const LENGTHS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'bg-green-500' },
  { key: 'sms', label: 'SMS', icon: Smartphone, color: 'bg-blue-500' },
  { key: 'email', label: 'Email', icon: Mail, color: 'bg-purple-500' },
  { key: 'website', label: 'Website', icon: Globe, color: 'bg-teal-500' },
];

// ─── Helpers ──────────────────────────────────────────────────────

function fmtMoney(n: number | undefined, sym: string): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function defaultEndDate() {
  const d = new Date(); d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}function nowDatetimeLocal(): string {
  const d = new Date(); d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

// ─── Website Placement Selector ──────────────────────────────────
const WEBSITE_PLACEMENTS = [
  { id: 'hero-banner', label: 'Homepage Banner', description: 'Hero banner on the restaurant homepage', recommended: true, icon: '🎯', templateId: 'hero-banner' },
  { id: 'offer-card', label: 'Offer Card', description: 'Featured card in the offers section', recommended: false, icon: '💳', templateId: 'offer-card' },
  { id: 'square-creative', label: 'Square Creative', description: 'Square format for social media and website grids', recommended: false, icon: '🖼️', templateId: 'square-creative' },
  { id: 'mobile-banner', label: 'Mobile Banner', description: 'Mobile-optimized banner for small screens', recommended: false, icon: '📱', templateId: 'mobile-banner' },
];

function WebsitePlacementSelector({
  offer, currencySymbol, selectedPlacement, onSelect,
}: {
  offer: any;
  currencySymbol: string;
  selectedPlacement: string;
  onSelect: (placement: string) => void;
}) {
  return (
    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-teal-600" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-teal-700">Website Placement</span>
      </div>
      <p className="text-[10px] text-teal-600 mb-3">Choose where this offer appears on your restaurant website</p>
      <div className="space-y-2">
        {WEBSITE_PLACEMENTS.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left cursor-pointer ${
              selectedPlacement === p.id
                ? 'border-teal-500 bg-white shadow-sm'
                : 'border-teal-100 hover:border-teal-300 bg-white/50'
            }`}
          >
            <span className="text-lg mt-0.5">{p.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-900">{p.label}</span>
                {p.recommended && (
                  <span className="text-[8px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">★ Recommended</span>
                )}
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">{p.description}</p>
            </div>
            {selectedPlacement === p.id && <CheckCircle2 className="w-4 h-4 text-teal-500 mt-1 shrink-0" />}
          </button>
        ))}
      </div>
      {/* Live preview snippet */}
      <div className="mt-4 bg-white rounded-xl border border-teal-200 p-4">
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wide mb-2">Preview</p>
        <div className="bg-gradient-to-r from-teal-600 to-cyan-600 rounded-xl p-4 text-white">
          <p className="text-[10px] font-bold uppercase opacity-80">{WEBSITE_PLACEMENTS.find(p => p.id === selectedPlacement)?.label || 'Banner'}</p>
          <h4 className="text-sm font-extrabold mt-1">{offer.title || 'Your Offer'}</h4>
          <p className="text-[10px] mt-1 opacity-80">
            {offer.type === 'percentage' ? `${offer.value}% OFF` : offer.type === 'flat' ? `${currencySymbol}${offer.value} OFF` : 'Special Offer'}
            {offer.minOrderValue ? ` · Min ${currencySymbol}${offer.minOrderValue}` : ''}
          </p>
          <button className="mt-2 px-3 py-1.5 bg-white text-teal-700 rounded-lg text-[10px] font-bold">Order Now →</button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Offer Review ────────────────────────────────────────

function StepOffer({
  offer, setOffer, products, currencySymbol, prefillReason,
}: {
  offer: any; setOffer: (o: any) => void;
  products: Product[]; currencySymbol: string; prefillReason?: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const update = (patch: any) => setOffer({ ...offer, ...patch });

  return (
    <div className="space-y-5">
      {prefillReason && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-bold text-blue-800">AI Recommended</p>
            <p className="text-[11px] text-blue-600 mt-0.5">{prefillReason}</p>
          </div>
        </div>
      )}

      {/* Offer Name */}
      <Field label="Offer Name">
        <input value={offer.title || ''} onChange={e => update({ title: e.target.value })}
          placeholder="e.g. Weekend Burger Combo"
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30 focus:border-[var(--brand-color)]" />
      </Field>

      {/* Offer Type + Value */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Offer Type">
          <select value={offer.type || 'percentage'} onChange={e => update({ type: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30">
            {OFFER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={offer.type === 'combo' ? 'Combo Price' : offer.type === 'flat' ? 'Discount (₹)' : offer.type === 'percentage' ? 'Discount (%)' : 'Value'}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">{offer.type === 'percentage' ? '%' : currencySymbol}</span>
            <input type="number" min="0" value={offer.value || ''} onChange={e => update({ value: parseFloat(e.target.value) || 0 })}
              className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
          </div>
        </Field>
      </div>

      {/* Min Order + Max Discount */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Minimum Order">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">{currencySymbol}</span>
            <input type="number" min="0" value={offer.minOrderValue || ''} onChange={e => update({ minOrderValue: parseFloat(e.target.value) || undefined })}
              placeholder="Optional"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
          </div>
        </Field>
        {offer.type === 'percentage' && (
          <Field label="Max Discount Cap">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">{currencySymbol}</span>
              <input type="number" min="0" value={offer.maxDiscount || ''} onChange={e => update({ maxDiscount: parseFloat(e.target.value) || undefined })}
                placeholder="Optional"
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
            </div>
          </Field>
        )}
      </div>

      {/* Validity */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start Date">
          <input type="date" value={offer.startDate || todayISO()} onChange={e => update({ startDate: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
        </Field>
        <Field label="End Date">
          <input type="date" value={offer.endDate || defaultEndDate()} onChange={e => update({ endDate: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
        </Field>
      </div>

      {/* Description */}
      <Field label="Description (shown to customers)">
        <textarea value={offer.description || ''} onChange={e => update({ description: e.target.value })}
          rows={2} placeholder="What's special about this offer?"
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
      </Field>

      {/* Advanced */}
      <button onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-[var(--brand-color)] cursor-pointer">
        {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAdvanced ? 'Hide' : 'More'} options
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Max Uses (total)">
              <input type="number" min="0" value={offer.maxUses || ''} onChange={e => update({ maxUses: parseInt(e.target.value) || undefined })}
                placeholder="Unlimited" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
            </Field>
            <Field label="Max Per Customer">
              <input type="number" min="0" value={offer.maxPerCustomer || ''} onChange={e => update({ maxPerCustomer: parseInt(e.target.value) || undefined })}
                placeholder="Unlimited" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
            </Field>
          </div>
          <Field label="Coupon Code (optional)">
            <input value={offer.couponCode || ''} onChange={e => update({ couponCode: e.target.value.toUpperCase() || undefined })}
              placeholder="e.g. BURGER20" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold uppercase focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Branch Selection ─────────────────────────────────────

function StepBranches({
  branches, selectedBranchIds, setSelectedBranchIds, aiRecommendation,
}: {
  branches: { id: string; name: string; isActive?: boolean }[];
  selectedBranchIds: string[];
  setSelectedBranchIds: (ids: string[]) => void;
  aiRecommendation?: string;
}) {
  // Filter to active branches consistently for both the "All branches" count and individual checkboxes
  const activeBranches = branches.filter(b => b.isActive !== false);
  // allSelected = every active branch is checked
  const allSelected = activeBranches.length > 0 && activeBranches.every(b => selectedBranchIds.includes(b.id));

  const toggleAll = () => {
    if (allSelected) setSelectedBranchIds([]);
    else setSelectedBranchIds(activeBranches.map(b => b.id));
  };

  const toggleBranch = (id: string) => {
    if (selectedBranchIds.includes(id)) {
      // Prevent deselecting the last branch — at least one must stay selected.
      if (selectedBranchIds.length <= 1) return;
      setSelectedBranchIds(selectedBranchIds.filter(i => i !== id));
    } else {
      setSelectedBranchIds([...selectedBranchIds, id]);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">Where should this offer run?</p>

      {aiRecommendation && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-blue-700">{aiRecommendation}</p>
        </div>
      )}

      {/* All branches toggle */}
      <button onClick={toggleAll}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer ${
          allSelected ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5' : 'border-slate-200 hover:border-slate-300'
        }`}>
        <div className={`w-5 h-5 rounded-md flex items-center justify-center ${allSelected ? 'bg-[var(--brand-color)]' : 'border-2 border-slate-300'}`}>
          {allSelected && <Check className="w-3.5 h-3.5 text-white" />}
        </div>
        <span className="text-sm font-bold text-slate-800">All branches</span>
        <span className="text-[10px] text-slate-400 ml-auto">{activeBranches.length} branches</span>
      </button>

      {/* Individual branches — always visible so the user can pick which ones */}
      <div className="space-y-2">
        {activeBranches.map(branch => {
          const selected = selectedBranchIds.includes(branch.id);
          return (
            <button key={branch.id} onClick={() => toggleBranch(branch.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer ${
                selected ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <div className={`w-5 h-5 rounded-md flex items-center justify-center ${selected ? 'bg-[var(--brand-color)]' : 'border-2 border-slate-300'}`}>
                {selected && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
              <span className="text-sm font-semibold text-slate-800">{branch.name}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        {allSelected ? `Offer will run at all ${activeBranches.length} branches` : `${selectedBranchIds.length} branch${selectedBranchIds.length !== 1 ? 'es' : ''} selected`}
      </p>
    </div>
  );
}

// ─── Step 3: Marketing Studio ─────────────────────────────────────

function StepStudio({
  studio, setStudio, offer, branches, selectedBranchIds, currencySymbol, onGenerate, generating,
}: {
  studio: any; setStudio: (s: any) => void;
  offer: any; branches: { id: string; name: string }[]; selectedBranchIds: string[];
  currencySymbol: string; onGenerate: (params: any) => void; generating: boolean;
}) {
  const update = (patch: any) => setStudio({ ...studio, ...patch });
  const selectedBranchNames = selectedBranchIds.length === 0
    ? branches.map(b => b.name).join(', ')
    : branches.filter(b => selectedBranchIds.includes(b.id)).map(b => b.name).join(', ');

  const previewMessage = studio.message || 'Your message will appear here...';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Controls */}
        <div className="space-y-4">
          {/* Creative */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 block">Creative</label>
            {studio.imageUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200">
                <img src={studio.imageUrl} alt="Creative" className="w-full h-40 object-cover" />
                <button onClick={() => update({ imageUrl: null })}
                  className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-lg text-white hover:bg-black/70 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-slate-300 hover:border-[var(--brand-color)] cursor-pointer transition-colors">
                <ImageIcon className="w-8 h-8 text-slate-300 mb-2" />
                <span className="text-[11px] font-bold text-slate-400">Upload image (optional)</span>
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => update({ imageUrl: reader.result });
                    reader.readAsDataURL(file);
                  }} />
              </label>
            )}
          </div>

          {/* Message */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Message</label>
              <button onClick={() => onGenerate({ style: studio.style, language: studio.language, length: studio.length, useEmojis: studio.useEmojis, channel: 'whatsapp' })}
                disabled={generating}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-[var(--brand-color)] bg-blue-50 hover:bg-blue-100 disabled:opacity-50 cursor-pointer">
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {studio.message ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            <textarea value={studio.message || ''} onChange={e => update({ message: e.target.value })}
              rows={4} placeholder="AI will generate a message, or write your own..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30" />
            {/* Quick actions */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { label: 'Shorter', action: 'shorter' },
                { label: 'Catchier', action: 'catchier' },
                { label: 'Professional', action: 'professional' },
                { label: 'Add urgency', action: 'urgency' },
                { label: studio.useEmojis ? 'Remove emojis' : 'Add emojis', action: 'emojis' },
              ].map(a => (
                <button key={a.action}
                  onClick={() => {
                    if (a.action === 'emojis') update({ useEmojis: !studio.useEmojis });
                    else onGenerate({ modify: a.action, style: studio.style, language: studio.language, length: studio.length, useEmojis: studio.useEmojis });
                  }}
                  disabled={generating}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 cursor-pointer">
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Style + Language + Length */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Style">
              <select value={studio.style || 'auto'} onChange={e => update({ style: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]">
                {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Language">
              <select value={studio.language || 'auto'} onChange={e => update({ language: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]">
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Length">
              <select value={studio.length || 'medium'} onChange={e => update({ length: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]">
                {LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
          </div>

          {/* Channels */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 block">Channels</label>
            <div className="flex gap-2">
              {CHANNELS.map(ch => {
                const enabled = studio.channels?.[ch.key] ?? (ch.key === 'whatsapp');
                const Icon = ch.icon;
                return (
                  <button key={ch.key} onClick={() => update({ channels: { ...studio.channels, [ch.key]: !enabled } })}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border-2 transition-all cursor-pointer ${
                      enabled ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5 text-[var(--brand-color)]' : 'border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}>
                    <Icon className="w-3.5 h-3.5" /> {ch.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Website placement (only when Website channel is selected) */}
          {studio.channels?.website && (
            <WebsitePlacementSelector
              offer={offer}
              currencySymbol={currencySymbol}
              selectedPlacement={studio.websitePlacement || 'hero-banner'}
              onSelect={(placement) => update({ websitePlacement: placement })}
            />
          )}

          {/* Test message */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 block">Send Test</label>
            <div className="flex gap-2">
              <input value={studio.testPhone || ''} onChange={e => update({ testPhone: e.target.value })}
                placeholder="Phone number or email"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]" />
              <button onClick={() => onGenerate({ sendTest: true, testTarget: studio.testPhone })}
                disabled={!studio.testPhone || generating}
                className="px-3 py-2 bg-slate-800 text-white rounded-lg text-[11px] font-bold hover:bg-slate-700 disabled:opacity-40 cursor-pointer">
                Send Test
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Live preview */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 block">Live Preview</label>
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            {/* WhatsApp-style preview */}
            <div className="bg-[#075e54] px-4 py-2.5 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-white" />
              <span className="text-[11px] font-bold text-white">WhatsApp Preview</span>
            </div>
            <div className="p-4 bg-[#e5ddd5] min-h-[200px]">
              <div className="bg-white rounded-lg p-3 shadow-sm max-w-[85%] ml-auto">
                {studio.imageUrl && (
                  <img src={studio.imageUrl} alt="" className="w-full h-32 object-cover rounded-lg mb-2" />
                )}
                <p className="text-[12px] text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {previewMessage}
                </p>
                <p className="text-[9px] text-slate-400 text-right mt-1">12:00 PM ✓✓</p>
              </div>
            </div>
          </div>

          {/* SMS preview */}
          {studio.channels?.sms && (
            <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <div className="bg-blue-500 px-4 py-2 flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-white" />
                <span className="text-[10px] font-bold text-white">SMS Preview ({(studio.message || '').length}/160 chars)</span>
              </div>
              <div className="p-3 bg-slate-50">
                <p className="text-[11px] text-slate-700 whitespace-pre-wrap">{studio.message || '—'}</p>
              </div>
            </div>
          )}

          {/* Email preview */}
          {studio.channels?.email && (
            <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <div className="bg-purple-500 px-4 py-2 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-white" />
                <span className="text-[10px] font-bold text-white">Email Preview</span>
              </div>
              <div className="p-3 bg-white">
                <p className="text-[10px] font-bold text-slate-800 mb-1">Subject: {studio.subject || offer.title || 'Special Offer'}</p>
                {studio.imageUrl && <img src={studio.imageUrl} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />}
                <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{studio.message || '—'}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────

function StepReview({
  offer, studio, branches, selectedBranchIds, currencySymbol, schedule,
}: {
  offer: any; studio: any; branches: { id: string; name: string }[];
  selectedBranchIds: string[]; currencySymbol: string; schedule: ScheduleState;
}) {
  const branchNames = selectedBranchIds.length === 0
    ? `All branches (${branches.length})`
    : branches.filter(b => selectedBranchIds.includes(b.id)).map(b => b.name).join(', ');

  const activeChannels = Object.entries(studio.channels || {}).filter(([, v]) => v).map(([k]) => k);

  const scheduleLabel = schedule.mode === 'immediate'
    ? 'Send immediately'
    : schedule.mode === 'scheduled'
    ? `Scheduled: ${schedule.scheduledAt || 'Not set'}`
    : 'Save as draft';

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-[var(--brand-color)]/5 to-blue-500/5 border border-[var(--brand-color)]/20 p-6">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-5 h-5 text-[var(--brand-color)]" />
          <h3 className="text-base font-bold text-slate-900">Campaign Summary</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 text-[12px]">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Offer</p>
            <p className="font-bold text-slate-800">{offer.title || 'Untitled'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Discount</p>
            <p className="font-bold text-slate-800">
              {offer.type === 'percentage' ? `${offer.value}% OFF` : offer.type === 'flat' ? `${currencySymbol}${offer.value} OFF` : offer.type === 'combo' ? `Combo @ ${currencySymbol}${offer.value}` : `${offer.value}`}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Validity</p>
            <p className="font-bold text-slate-800">{offer.startDate || todayISO()} — {offer.endDate || 'Ongoing'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Branches</p>
            <p className="font-bold text-slate-800">{branchNames}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Channels</p>
            <p className="font-bold text-slate-800">{activeChannels.length > 0 ? activeChannels.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' + ') : 'None selected'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Schedule</p>
            <p className="font-bold text-slate-800">{scheduleLabel}</p>
          </div>
          {offer.minOrderValue && (
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Min Order</p>
              <p className="font-bold text-slate-800">{currencySymbol}{offer.minOrderValue}</p>
            </div>
          )}
        </div>
      </div>

      {/* Message preview */}
      {studio.message && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Message Preview</p>
          <p className="text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">{studio.message}</p>
          {studio.imageUrl && (
            <img src={studio.imageUrl} alt="" className="mt-3 w-full h-32 object-cover rounded-lg" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Schedule ─────────────────────────────────────────────

interface ScheduleState {
  mode: 'immediate' | 'scheduled' | 'draft';
  scheduledAt: string;
}

function StepSchedule({
  schedule, setSchedule,
}: {
  schedule: ScheduleState;
  setSchedule: (s: ScheduleState) => void;
}) {
  const today = todayISO();
  const maxDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">When should this campaign go live?</h3>
        <p className="text-[11px] text-slate-400">Choose when your customers will receive the offer.</p>
      </div>

      {/* Schedule options */}
      <div className="space-y-3">
        {/* Immediate */}
        <button
          onClick={() => setSchedule({ mode: 'immediate', scheduledAt: '' })}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all cursor-pointer text-left ${
            schedule.mode === 'immediate'
              ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5'
              : 'border-slate-200 hover:border-slate-300'
          }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            schedule.mode === 'immediate' ? 'bg-[var(--brand-color)] text-white' : 'bg-slate-100 text-slate-400'
          }`}>
            <Zap className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Send Immediately</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Campaign starts as soon as it's created</p>
          </div>
          {schedule.mode === 'immediate' && <Check className="w-5 h-5 text-[var(--brand-color)] shrink-0" />}
        </button>

        {/* Scheduled */}
        <button
          onClick={() => {
            if (schedule.mode !== 'scheduled') {
              setSchedule({ mode: 'scheduled', scheduledAt: schedule.scheduledAt || nowDatetimeLocal() });
            }
          }}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all cursor-pointer text-left ${
            schedule.mode === 'scheduled'
              ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5'
              : 'border-slate-200 hover:border-slate-300'
          }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            schedule.mode === 'scheduled' ? 'bg-[var(--brand-color)] text-white' : 'bg-slate-100 text-slate-400'
          }`}>
            <CalendarDays className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Schedule for Later</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Pick a date and time to send</p>
          </div>
          {schedule.mode === 'scheduled' && <Check className="w-5 h-5 text-[var(--brand-color)] shrink-0" />}
        </button>

        {/* Date/time picker (visible when scheduled is selected) */}
        {schedule.mode === 'scheduled' && (
          <div className="ml-14 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <Field label="Date & Time">
              <input
                type="datetime-local"
                value={schedule.scheduledAt}
                min={nowDatetimeLocal()}
                max={`${maxDate}T23:59`}
                onChange={e => setSchedule({ ...schedule, scheduledAt: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30 focus:border-[var(--brand-color)] [color-scheme:light]"
              />
            </Field>
            <p className="text-[10px] text-slate-400">
              Customers will receive the campaign at the scheduled time. You can cancel before it goes live.
            </p>
          </div>
        )}

        {/* Draft */}
        <button
          onClick={() => setSchedule({ mode: 'draft', scheduledAt: '' })}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all cursor-pointer text-left ${
            schedule.mode === 'draft'
              ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5'
              : 'border-slate-200 hover:border-slate-300'
          }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            schedule.mode === 'draft' ? 'bg-[var(--brand-color)] text-white' : 'bg-slate-100 text-slate-400'
          }`}>
            <Clock className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Save as Draft</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Save everything and continue editing later</p>
          </div>
          {schedule.mode === 'draft' && <Check className="w-5 h-5 text-[var(--brand-color)] shrink-0" />}
        </button>
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────

export default function CampaignWizard({
  currencySymbol, products, branches, segments, settings, prefill, onDone, onClose,
}: CampaignWizardProps) {
  const [step, setStep] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);

  // Step 1: Offer state — prefill from AI recommendation
  const [offer, setOffer] = useState(() => ({
    title: prefill?.title || '',
    description: prefill?.description || '',
    type: prefill?.type || 'percentage',
    value: prefill?.value || 0,
    minOrderValue: prefill?.minOrderValue || undefined,
    maxDiscount: prefill?.maxDiscount || undefined,
    startDate: prefill?.startDate || todayISO(),
    endDate: prefill?.endDate || defaultEndDate(),
    applicableCategories: prefill?.applicableCategories || [],
    applicableProductIds: prefill?.applicableProductIds || [],
    maxUses: prefill?.maxUses || undefined,
    maxPerCustomer: prefill?.maxPerCustomer || undefined,
    couponCode: prefill?.couponCode || undefined,
    recommendationSource: prefill?.recommendationSource || 'manual',
    recommendationReason: prefill?.recommendationReason || '',
    isAiGenerated: !!prefill?.recommendationSource,
  }));

  // Step 2: Branch state
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(() => {
    if (prefill?.branchIds?.length) return prefill.branchIds;
    return []; // empty = all branches
  });

  // Step 3: Studio state
  // NOTE: Creative (imageUrl) starts EMPTY — only set by explicit user upload.
  // We do NOT use prefill?.imageUrl here because recommendation images may be
  // POS screenshots or unrelated assets, not campaign creatives.
  const [studio, setStudio] = useState(() => ({
    message: prefill?.whatsappMessage || prefill?.message || '',
    subject: prefill?.emailSubject || '',
    imageUrl: null,
    style: 'auto',
    language: 'auto',
    length: 'medium',
    useEmojis: true,
    channels: { whatsapp: true, sms: false, email: false, website: false },
    websitePlacement: 'hero-banner',
    testPhone: '',
  }));

  // Step 5: Schedule state
  const [schedule, setSchedule] = useState<ScheduleState>({
    mode: 'immediate',
    scheduledAt: '',
  });

  const stepKeys = STEPS.map(s => s.key);
  const currentStep = stepKeys[step];
  const canNext = step < STEPS.length - 1;
  const canPrev = step > 0;

  const goNext = () => {
    if (!canNext) return;
    // Step 2 (Branches) requires at least one branch selected.
    if (currentStep === 'branches' && selectedBranchIds.length === 0) return;
    setStep(step + 1);
  };
  const goPrev = () => { if (canPrev) setStep(step - 1); };

  // ─── Save Draft ────────────────────────────────────────────────
  // Persists all wizard state to localStorage so the user can resume later.
  const handleSaveDraft = useCallback(() => {
    try {
      const draft = {
        offer,
        selectedBranchIds,
        studio,
        schedule,
        currentStep: step,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('pos_campaign_draft', JSON.stringify(draft));
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch (err) {
      debugWarn('CampaignWizard', 'draft save failed:', err);
      setError('Could not save draft. Please try again.');
    }
  }, [offer, selectedBranchIds, studio, schedule, step]);

  // ─── AI message generation ─────────────────────────────────────
  const handleGenerate = useCallback(async (params: any) => {
    if (params.sendTest) {
      // Test message — call backend
      if (!studio.message?.trim()) {
        alert('No message to send. Generate or write a message first.');
        return;
      }
      try {
        const result = await api.sendTestMessage({
          target: params.testTarget,
          message: studio.message,
          channels: Object.entries(studio.channels).filter(([, v]) => v).map(([k]) => k),
        });
        if (result?.sent) {
          alert('✓ Test message sent!\n\nNote: If no WhatsApp/SMS/Email provider is connected, this is a simulation. Connect a provider in Settings to send real messages.');
        } else {
          alert('Test message queued. Connect a provider in Settings to send real messages.');
        }
      } catch (err) {
        debugWarn('CampaignWizard', 'test send failed:', err);
        alert('Could not send test. Check the target and try again.');
      }
      return;
    }

    setGenerating(true);
    try {
      const branchNames = selectedBranchIds.length === 0
        ? branches.map(b => b.name).join(', ')
        : branches.filter(b => selectedBranchIds.includes(b.id)).map(b => b.name).join(', ');

      const restaurantName = settings?.restaurantName || 'Our Restaurant';

      const result = await api.generateMarketingMessage({
        offer: {
          title: offer.title,
          type: offer.type,
          value: offer.value,
          description: offer.description,
          minOrderValue: offer.minOrderValue,
          startDate: offer.startDate,
          endDate: offer.endDate,
        },
        restaurantName,
        branchNames,
        style: params.style || studio.style,
        language: params.language || studio.language,
        length: params.length || studio.length,
        useEmojis: params.useEmojis ?? studio.useEmojis,
        channel: params.channel || 'whatsapp',
        modify: params.modify,
        currentMessage: studio.message,
      });

      if (result?.message) {
        setStudio((prev: any) => ({
          ...prev,
          message: result.message,
          subject: result.subject || prev.subject,
        }));
      }
    } catch (err) {
      debugWarn('CampaignWizard', 'message generation failed:', err);
      setError('Could not generate message. You can write it yourself or try again.');
    } finally {
      setGenerating(false);
    }
  }, [offer, studio, branches, selectedBranchIds, settings]);

  // ─── Final broadcast / schedule / draft ────────────────────────
  const handleBroadcast = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      // 1. Create the offer
      const offerPayload: any = {
        title: offer.title,
        description: offer.description || offer.title,
        type: offer.type,
        value: offer.value,
        ...(offer.minOrderValue ? { minOrderValue: offer.minOrderValue } : {}),
        ...(offer.maxDiscount ? { maxDiscount: offer.maxDiscount } : {}),
        ...(offer.maxUses ? { maxUses: offer.maxUses } : {}),
        ...(offer.maxPerCustomer ? { maxPerCustomer: offer.maxPerCustomer } : {}),
        ...(offer.couponCode ? { couponCode: offer.couponCode } : {}),
        applicableCategories: offer.applicableCategories || [],
        applicableProductIds: offer.applicableProductIds || [],
        startDate: offer.startDate,
        endDate: offer.endDate,
        branchIds: selectedBranchIds.length > 0 ? selectedBranchIds : branches.filter(b => b.isActive !== false).map(b => b.id),
        recommendationSource: offer.recommendationSource,
        recommendationReason: offer.recommendationReason,
        isAiGenerated: offer.isAiGenerated,
        status: 'active',
        imageUrl: studio.imageUrl || undefined,
        whatsappMessage: studio.message || undefined,
        emailSubject: studio.subject || offer.title,
        emailBody: studio.message || undefined,
      };

      const createdOffer = await api.createOffer(offerPayload);
      const offerId = createdOffer?._id || createdOffer?.id;

      if (!offerId) {
        setError('Offer creation failed. Please try again.');
        setSaving(false);
        return;
      }

      // 2. Create the campaign
      const activeChannels = Object.entries(studio.channels).filter(([, v]) => v).map(([k]) => k);

      // Determine campaign schedule and status
      let campaignStatus = 'scheduled';
      let campaignSchedule: any = { mode: 'immediate' };

      if (schedule.mode === 'immediate') {
        campaignSchedule = { mode: 'immediate' };
        campaignStatus = 'scheduled';
      } else if (schedule.mode === 'scheduled' && schedule.scheduledAt) {
        campaignSchedule = {
          mode: 'scheduled',
          scheduledAt: new Date(schedule.scheduledAt).toISOString(),
        };
        campaignStatus = 'scheduled';
      } else if (schedule.mode === 'draft') {
        campaignStatus = 'draft';
        campaignSchedule = { mode: 'immediate' };
      }

      const campaignPayload: any = {
        name: offer.title,
        description: offer.description,
        offerId,
        audience: {
          segmentIds: prefill?.targetSegmentIds || [],
          segmentNames: prefill?.targetSegmentNames || [],
          customerPhones: [],
        },
        template: {
          channel: activeChannels[0] || 'whatsapp',
          subject: studio.subject || offer.title,
          message: studio.message || '',
        },
        schedule: campaignSchedule,
        status: campaignStatus,
      };

      const createdCampaign = await api.createCampaign(campaignPayload);
      const campaignId = createdCampaign?._id || createdCampaign?.id;

      // 3. If Website channel is selected, create a Promotion for the website
      if (studio.channels?.website && offerId) {
        try {
          const placementId = studio.websitePlacement || 'hero-banner';
          const placement = WEBSITE_PLACEMENTS.find(p => p.id === placementId);
          const templateId = placement?.templateId || 'hero-banner';
          const promotionPayload: any = {
            offerId,
            name: offer.title,
            templateId,
            channels: ['website'],
            creative: {
              title: offer.title,
              subtitle: offer.type === 'percentage' ? `${offer.value}% OFF` : offer.type === 'flat' ? `₹${offer.value} OFF` : 'Special Offer',
              description: offer.description || '',
              cta: 'Order Now',
              language: studio.language === 'auto' ? 'en' : (studio.language || 'en'),
              colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
              image: studio.imageUrl ? { key: studio.imageUrl, source: 'upload' } : null,
            },
          };
          const createdPromo = await api.createPromotion(promotionPayload);
          // Publish the promotion so it's visible on the website immediately
          if (schedule.mode !== 'draft' && createdPromo?.id) {
            await api.publishPromotion(createdPromo.id).catch(() => {
              debugWarn('CampaignWizard', 'website promotion publish skipped — offer may not be active yet');
            });
          }
        } catch (promoErr) {
          // Promotion failure is non-fatal — campaign still works
          debugWarn('CampaignWizard', 'website promotion creation skipped:', promoErr);
        }
      }

      // 4. LIFECYCLE: Mark the recommendation as converted so it is not
      //    re-recommended while this offer/campaign is active.
      if (prefill?.id) {
        void api.advisorMarkConverted(prefill.id, offerId, campaignId || undefined).catch(() => {});
      }

      // 5. Clear saved draft on success
      try { localStorage.removeItem('pos_campaign_draft'); } catch {}

      onDone(offerId, campaignId || '');
    } catch (err) {
      debugWarn('CampaignWizard', 'broadcast failed:', err);
      setError('Campaign could not be sent. No messages were sent. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [offer, studio, selectedBranchIds, branches, prefill, schedule, onDone]);

  // Determine what the final button label should be
  const finalButtonLabel = schedule.mode === 'draft'
    ? 'Save Draft'
    : schedule.mode === 'scheduled'
    ? 'Schedule Campaign'
    : 'Broadcast Now';

  const finalButtonIcon = schedule.mode === 'draft'
    ? <Save className="w-3.5 h-3.5" />
    : schedule.mode === 'scheduled'
    ? <CalendarDays className="w-3.5 h-3.5" />
    : <Send className="w-3.5 h-3.5" />;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-page)]">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-900">Create Campaign</h2>
            <p className="text-[10px] text-slate-400">Step {step + 1} of {STEPS.length}</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 mt-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button key={s.key} onClick={() => { if (i <= step) setStep(i); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  isActive ? 'bg-[var(--brand-color)] text-white' :
                  isDone ? 'bg-green-50 text-green-700 hover:bg-green-100' :
                  'text-slate-400 hover:text-slate-600'
                }`}>
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-2">
            <Info className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-rose-700">{error}</p>
          </div>
        )}

        {currentStep === 'offer' && (
          <StepOffer offer={offer} setOffer={setOffer} products={products} currencySymbol={currencySymbol}
            prefillReason={offer.recommendationReason} />
        )}
        {currentStep === 'branches' && (
          <StepBranches branches={branches} selectedBranchIds={selectedBranchIds}
            setSelectedBranchIds={setSelectedBranchIds} aiRecommendation={prefill?.branchRecommendation} />
        )}
        {currentStep === 'studio' && (
          <StepStudio studio={studio} setStudio={setStudio} offer={offer} branches={branches}
            selectedBranchIds={selectedBranchIds} currencySymbol={currencySymbol}
            onGenerate={handleGenerate} generating={generating} />
        )}
        {currentStep === 'review' && (
          <StepReview offer={offer} studio={studio} branches={branches}
            selectedBranchIds={selectedBranchIds} currencySymbol={currencySymbol} schedule={schedule} />
        )}
        {currentStep === 'schedule' && (
          <StepSchedule schedule={schedule} setSchedule={setSchedule} />
        )}
      </div>

      {/* Footer navigation */}
      <div className="bg-white border-t border-slate-200 px-5 py-3 shrink-0 flex items-center justify-between gap-3">
        <button onClick={goPrev} disabled={!canPrev}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 cursor-pointer transition-all">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        <div className="flex items-center gap-2">
          {/* Save Draft button — always visible */}
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 cursor-pointer transition-all"
            title="Save progress as draft"
          >
            {draftSaved ? (
              <><Check className="w-3.5 h-3.5 text-emerald-500" /> Saved!</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> Draft</>
            )}
          </button>

          {/* Primary action: Next / Broadcast / Save Draft */}
          {currentStep === 'review' ? (
            <button onClick={handleBroadcast} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer transition-all shadow-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : finalButtonIcon}
              {saving ? 'Working...' : finalButtonLabel}
            </button>
          ) : (
            <button onClick={goNext}
              disabled={currentStep === 'branches' && selectedBranchIds.length === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all shadow-sm">
              Next <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

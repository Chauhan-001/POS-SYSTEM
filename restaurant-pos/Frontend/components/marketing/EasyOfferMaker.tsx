/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EasyOfferMaker — the "anyone can use it" offer & combo wizard.
 *
 * Same design language as EasyRecipeMaker: ONE question per screen, giant
 * touch targets, plain words + emoji + colour (no accounting jargon), and a
 * single big green save button. Built for a child, an elderly owner, or
 * someone who cannot read much.
 *
 * It ONLY reuses existing, tested backend pieces — AI never creates or
 * mutates anything:
 *   - POST /profitability/offers/preview  (deterministic economics)
 *   - POST /profitability/combos/assistant (advisory price suggestion only)
 *   - POST /offers                         (the real save; server validates)
 *
 * Flow:  Pick what to make (discount or combo) → tap the dishes → how much
 * off / combo price → "the money" (auto-calculated) → one-tap save.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Check, ChevronLeft, ChevronRight, Plus, Minus, Loader2, Search,
  Sparkles, CircleAlert, PartyPopper,
} from 'lucide-react';
import {
  fetchOfferPreview, fetchComboAssistant, createOffer,
} from '../../src/api/client';
import { emojiFor } from '../inventory/pages/EasyRecipeMaker';
import { debugWarn } from '../../src/utils/debugLog';

const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, sym = '₹') => sym + money(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

type Mode = 'offer' | 'combo';
type Step = 'mode' | 'which' | 'amount' | 'money' | 'done';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  products: any[];
  currencySymbol: string;
}

export default function EasyOfferMaker({ onClose, onSaved, products, currencySymbol }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>('mode');
  const [selected, setSelected] = useState<string[]>([]);
  const [discountType, setDiscountType] = useState<'percentage' | 'flat'>('percentage');
  const [value, setValue] = useState(10);
  const [saving, setSaving] = useState(false);
  const [savedTitle, setSavedTitle] = useState('');
  const [fatal, setFatal] = useState('');

  const menu = useMemo(
    () => (Array.isArray(products) ? products.filter((p: any) => p && (p.id || p._id) && (Number(p.price) || 0) > 0) : []),
    [products],
  );

  const go = (s: Step) => setStep(s);

  const pickAll = () => {
    // Select everything when not all selected, otherwise clear (toggle).
    setSelected((prev) => (prev.length === menu.length && menu.length > 0 ? [] : menu.map((p) => String(p.id || p._id))));
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const picked = useMemo(() => menu.filter((p) => selected.includes(String(p.id || p._id))), [menu, selected]);
  const individualValue = money(picked.reduce((s, p) => s + (Number(p.price) || 0), 0));

  const canProceed = selected.length > 0;

  // ─── Deterministic money preview (backend) ──────────────────────
  const [preview, setPreview] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const loadPreview = useCallback(async () => {
    if (!mode || selected.length === 0) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await fetchOfferPreview({
        title: 'preview',
        type: mode === 'combo' ? 'combo' : discountType,
        value,
        applicableProductIds: selected,
      });
      const d = res?.data || res;
      setPreview(d || null);
    } catch (err) {
      debugWarn('EasyOfferMaker', 'preview failed:', err);
      setPreview(null);
      setPreviewError('Could not check the money right now — you can still save; the numbers will be calculated when we can reach the server.');
    } finally {
      setPreviewLoading(false);
    }
  }, [mode, selected, value, discountType]);

  useEffect(() => {
    if (step === 'money') void loadPreview();
  }, [step, loadPreview]);

  // ─── Combo price suggestion (advisory only) ─────────────────────
  const [suggesting, setSuggesting] = useState(false);
  const askSuggestion = async () => {
    if (picked.length === 0 || suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetchComboAssistant(`combo of ${picked.map((p) => p.name).join(' and ')}`);
      const d = res?.data || res;
      const price = d?.recommended?.price ?? d?.combos?.[0]?.price;
      if (price) setValue(Math.max(1, Math.round(price)));
    } catch (err) {
      debugWarn('EasyOfferMaker', 'combo suggestion failed:', err);
    } finally {
      setSuggesting(false);
    }
  };

  // ─── Save (one tap, server is truth) ────────────────────────────
  const titleOf = () => {
    const first = picked.slice(0, 3).map((p) => p.name).join(' + ');
    const more = picked.length > 3 ? ` +${picked.length - 3}` : '';
    if (mode === 'combo') return `Combo · ${first}${more}`;
    const base = discountType === 'percentage' ? `${value}% OFF` : `${fmt(value, currencySymbol)} OFF`;
    return `${base}${first ? ` on ${first}${more}` : ''}`;
  };

  const handleSave = async () => {
    if (!mode || selected.length === 0 || saving) return;
    // Server schema caps applicableProductIds at 200 — guard before saving.
    if (selected.length > 200) { setFatal('That is more than 200 dishes — pick fewer for one offer.'); return; }
    setSaving(true);
    setFatal('');
    try {
      const title = titleOf();
      const description = mode === 'combo'
        ? `Combo deal: ${picked.map((p) => p.name).join(' + ')} for ${fmt(value, currencySymbol)} (worth ${fmt(individualValue, currencySymbol)}).`
        : `${discountType === 'percentage' ? `${value}% off` : `${fmt(value, currencySymbol)} off`} on ${picked.length === menu.length ? 'your whole menu' : picked.map((p) => p.name).join(', ')}.`;
      const created = await createOffer({
        title,
        description,
        shortDescription: mode === 'combo' ? `Combo · ${fmt(value, currencySymbol)}` : `${discountType === 'percentage' ? `${value}% OFF` : `${fmt(value, currencySymbol)} OFF`}`,
        type: mode === 'combo' ? 'combo' : discountType,
        value,
        applicableProductIds: selected,
        targetSegmentIds: [],
        targetSegmentNames: [],
        status: 'active',
        isAutoActivate: false,
      });
      if (!created) { setFatal('Could not save — check the connection and try again.'); return; }
      setSavedTitle(title);
      onSaved?.();
      go('done');
    } catch (err: any) {
      debugWarn('EasyOfferMaker', 'save failed:', err);
      setFatal(err?.response?.data?.error || err?.message || 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Verdict for the money screen ───────────────────────────────
  const verdict = useMemo(() => {
    if (mode === 'combo') {
      const c = preview?.combo;
      if (!c) return null;
      if ((Number(c.contribution) || 0) < 0) return { emoji: '😟', title: 'This combo loses money', tone: 'text-red-600', bg: 'bg-red-50 border-red-300' };
      if (c.status === 'tight' || (Number(c.contributionMarginPercent) || 0) < 20) return { emoji: '😕', title: 'You keep very little', tone: 'text-amber-600', bg: 'bg-amber-50 border-amber-300' };
      return { emoji: '😊', title: 'Great deal — customers save and you keep a good amount', tone: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300' };
    }
    const rows: any[] = preview?.rows || [];
    if (rows.length === 0) return null;
    const losing = rows.filter((r) => (Number(r.discountedContribution) || 0) < 0);
    const low = rows.filter((r) => (Number(r.discountedContribution) || 0) >= 0 && (Number(r.discountedContribution) || 0) / (Number(r.sellingPrice) || 1) < 0.15);
    if (losing.length > 0) return { emoji: '😟', title: `${losing.length} dish${losing.length === 1 ? '' : 'es'} would lose money with this discount`, tone: 'text-red-600', bg: 'bg-red-50 border-red-300' };
    if (low.length > 0) return { emoji: '😕', title: `${low.length} dish${low.length === 1 ? '' : 'es'} would keep very little`, tone: 'text-amber-600', bg: 'bg-amber-50 border-amber-300' };
    return { emoji: '😊', title: 'Looks good — every dish still keeps a healthy amount', tone: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300' };
  }, [preview, mode]);

  return (
    <div
      className="fixed inset-0 z-[250] bg-[#faf8ff] flex flex-col"
      role="dialog"
      aria-label="Easy offer maker"
    >
      {/* Top bar */}
      <div className="bg-[#191b23] text-white px-4 sm:px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl" aria-hidden>🏷️</span>
          <span className="text-lg sm:text-xl font-black tracking-tight">Easy Offer Maker</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Progress dots */}
      {mode && step !== 'done' && (
        <div className="flex items-center justify-center gap-3 sm:gap-6 py-3 shrink-0">
          {[
            { id: 'which' as Step, icon: '🍽️', label: 'Dishes' },
            { id: 'amount' as Step, icon: mode === 'combo' ? '💵' : '🎯', label: mode === 'combo' ? 'Price' : 'Discount' },
            { id: 'money' as Step, icon: '💰', label: 'Money' },
          ].map((s, i) => {
            const order: Step[] = ['which', 'amount', 'money'];
            const idx = order.indexOf(step);
            const done = idx > i;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-3 sm:gap-6">
                {i > 0 && <div className={`w-8 sm:w-14 h-1.5 rounded-full ${done || active ? 'bg-emerald-400' : 'bg-gray-200'}`} aria-hidden />}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-2xl border-2 transition-all ${
                      active ? 'border-[var(--brand-color)] bg-blue-50 scale-110 shadow-md'
                        : done ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
                    }`}
                    aria-hidden
                  >
                    {done && !active ? <Check className="w-6 h-6 text-emerald-500" /> : s.icon}
                  </div>
                  <span className={`mt-1 text-[10px] sm:text-xs font-bold ${active ? 'text-[var(--brand-color)]' : 'text-gray-400'}`}>{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-10">
        {fatal && (
          <div className="max-w-xl mx-auto mt-10 bg-white rounded-3xl border border-red-200 p-8 text-center">
            <CircleAlert className="w-14 h-14 text-red-400 mx-auto mb-4" />
            <p className="text-xl font-bold text-gray-800">{fatal}</p>
            <button onClick={onClose} className="mt-6 w-full max-w-xs mx-auto block py-4 rounded-2xl bg-[#191b23] text-white text-lg font-black cursor-pointer hover:bg-black transition-colors">
              Close
            </button>
          </div>
        )}

        {!fatal && step === 'mode' && (
          <ModePick onPick={(m) => { setMode(m); setStep('which'); }} onClose={onClose} hasDishes={menu.length > 0} />
        )}

        {!fatal && step === 'which' && mode && (
          <WhichScreen
            menu={menu}
            mode={mode}
            selected={selected}
            currencySymbol={currencySymbol}
            onToggle={toggle}
            onPickAll={pickAll}
            onBack={() => setStep('mode')}
            onNext={() => setStep('amount')}
            canProceed={canProceed}
          />
        )}

        {!fatal && step === 'amount' && mode && (
          <AmountScreen
            mode={mode}
            value={value}
            discountType={discountType}
            currencySymbol={currencySymbol}
            picked={picked}
            individualValue={individualValue}
            suggesting={suggesting}
            onDiscountType={setDiscountType}
            onValue={setValue}
            onSuggest={() => void askSuggestion()}
            onBack={() => setStep('which')}
            onNext={() => setStep('money')}
          />
        )}

        {!fatal && step === 'money' && mode && (
          <MoneyScreen
            mode={mode}
            value={value}
            discountType={discountType}
            currencySymbol={currencySymbol}
            picked={picked}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            verdict={verdict}
            individualValue={individualValue}
            saving={saving}
            onBack={() => setStep('amount')}
            onSave={() => void handleSave()}
          />
        )}

        {!fatal && step === 'done' && (
          <DoneScreen
            title={savedTitle}
            onAgain={() => {
              setMode(null); setSelected([]); setValue(10);
              setDiscountType('percentage'); setPreview(null); setSavedTitle(''); setStep('mode');
            }}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 1 — WHAT DO YOU WANT TO MAKE?
// ────────────────────────────────────────────────────────────────────
function ModePick({ onPick, onClose, hasDishes }: { onPick: (m: Mode) => void; onClose: () => void; hasDishes: boolean }) {
  if (!hasDishes) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white rounded-3xl border border-[#e1e2ed] p-8 text-center">
        <span className="text-6xl" aria-hidden>🍽️</span>
        <p className="text-2xl font-black text-gray-700 mt-4">No dishes on the menu yet</p>
        <p className="text-lg text-gray-400 mt-2">Add your dishes in Products first, then come back to make offers.</p>
        <button onClick={onClose} className="mt-6 w-full max-w-xs mx-auto block py-4 rounded-2xl bg-[var(--brand-color)] text-white text-xl font-black cursor-pointer hover:bg-[#003ea8] transition-colors">
          OK, close
        </button>
      </div>
    );
  }
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">What do you want to make?</h2>
      <p className="text-center text-base text-gray-400 mt-2">Tap one — the numbers are done for you</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        <button
          onClick={() => onPick('offer')}
          className="bg-white rounded-3xl border-4 border-[#e1e2ed] hover:border-[var(--brand-color)] hover:shadow-xl active:scale-[0.98] transition-all p-8 cursor-pointer"
        >
          <span className="text-6xl block" aria-hidden>🏷️</span>
          <p className="mt-3 text-xl sm:text-2xl font-black text-gray-900">A discount</p>
          <p className="text-base text-gray-400 mt-1">“10% off” or “₹50 off” on some dishes</p>
        </button>
        <button
          onClick={() => onPick('combo')}
          className="bg-white rounded-3xl border-4 border-[#e1e2ed] hover:border-[var(--brand-color)] hover:shadow-xl active:scale-[0.98] transition-all p-8 cursor-pointer"
        >
          <span className="text-6xl block" aria-hidden>📦</span>
          <p className="mt-3 text-xl sm:text-2xl font-black text-gray-900">A combo deal</p>
          <p className="text-base text-gray-400 mt-1">Burger + fries + drink for one price</p>
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 2 — WHICH DISHES?
// ────────────────────────────────────────────────────────────────────
function WhichScreen({ menu, mode, selected, currencySymbol, onToggle, onPickAll, onBack, onNext, canProceed }: {
  menu: any[]; mode: Mode; selected: string[]; currencySymbol: string;
  onToggle: (id: string) => void; onPickAll: () => void;
  onBack: () => void; onNext: () => void; canProceed: boolean;
}) {
  const [q, setQ] = useState('');
  const allSelected = menu.length > 0 && selected.length === menu.length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return menu;
    return menu.filter((p) => (p.name || '').toLowerCase().includes(needle));
  }, [menu, q]);

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">
        {mode === 'combo' ? 'What is in the combo?' : 'Which dishes get the discount?'}
      </h2>
      <p className="text-center text-base text-gray-400 mt-2">Tap the dishes — tap again to remove</p>

      <div className="flex items-center gap-3 mt-6 max-w-lg mx-auto">
        <button
          onClick={onPickAll}
          className={`flex-1 py-4 rounded-2xl border-4 text-lg font-black cursor-pointer transition-all active:scale-[0.98] ${
            allSelected ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-[#e1e2ed] bg-white text-gray-600 hover:border-emerald-300'
          }`}
        >
          {allSelected ? '✓ All dishes' : '🗂️ All dishes'}
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search dishes"
            className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-[#e1e2ed] bg-white text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-[var(--brand-color)]/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mt-6">
        {list.map((p) => {
          const id = String(p.id || p._id);
          const on = selected.includes(id);
          return (
            <button
              key={id}
              onClick={() => onToggle(id)}
              aria-pressed={on}
              className={`relative bg-white rounded-3xl border-4 p-4 sm:p-5 flex flex-col items-center text-center cursor-pointer transition-all min-h-[150px] active:scale-[0.97] ${
                on ? 'border-emerald-400 bg-emerald-50/60 shadow-md' : 'border-[#e1e2ed] hover:border-gray-300'
              }`}
            >
              {on && (
                <span className="absolute top-2 right-2 w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                  <Check className="w-5 h-5" />
                </span>
              )}
              <span className="text-5xl sm:text-6xl" aria-hidden>{emojiFor(p.name)}</span>
              <span className="mt-2.5 text-base sm:text-lg font-black text-gray-900 leading-tight">{p.name}</span>
              <span className="mt-1 text-lg font-black text-[var(--brand-color)]">{fmt(p.price, currencySymbol)}</span>
            </button>
          );
        })}
        {list.length === 0 && <p className="col-span-full text-center py-10 text-lg text-gray-400">Nothing found — check the spelling.</p>}
      </div>

      <div className="flex gap-3 mt-8 max-w-2xl mx-auto">
        <button onClick={onBack} className="px-6 py-5 rounded-2xl border-2 border-[#e1e2ed] bg-white text-gray-600 text-lg font-black flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 py-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-30"
        >
          {selected.length} selected · Next <ChevronRight className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 3 — HOW MUCH?  (big stepper; combo gets an AI price suggestion)
// ────────────────────────────────────────────────────────────────────
function AmountScreen({ mode, value, discountType, currencySymbol, picked, individualValue, suggesting, onDiscountType, onValue, onSuggest, onBack, onNext }: {
  mode: Mode; value: number; discountType: 'percentage' | 'flat'; currencySymbol: string;
  picked: any[]; individualValue: number; suggesting: boolean;
  onDiscountType: (t: 'percentage' | 'flat') => void; onValue: (n: number) => void;
  onSuggest: () => void; onBack: () => void; onNext: () => void;
}) {
  const step = mode === 'combo' ? 10 : discountType === 'percentage' ? 5 : 10;
  const min = 0;
  const max = mode === 'combo' ? individualValue : discountType === 'percentage' ? 100 : individualValue;

  const title = mode === 'combo'
    ? 'What is the combo price?'
    : discountType === 'percentage' ? 'How much off? (percent)' : 'How much off? (rupees)';

  return (
    <div className="max-w-xl mx-auto text-center">
      <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mt-2">{title}</h2>

      {mode === 'offer' && (
        <div className="flex justify-center gap-3 mt-6">
          <button
            onClick={() => onDiscountType('percentage')}
            className={`px-8 py-4 rounded-2xl border-4 text-xl font-black cursor-pointer transition-all ${
              discountType === 'percentage' ? 'border-[var(--brand-color)] bg-blue-50 text-[var(--brand-color)]' : 'border-[#e1e2ed] bg-white text-gray-500'
            }`}
          >
            %
          </button>
          <button
            onClick={() => onDiscountType('flat')}
            className={`px-8 py-4 rounded-2xl border-4 text-xl font-black cursor-pointer transition-all ${
              discountType === 'flat' ? 'border-[var(--brand-color)] bg-blue-50 text-[var(--brand-color)]' : 'border-[#e1e2ed] bg-white text-gray-500'
            }`}
          >
            {currencySymbol}
          </button>
        </div>
      )}

      {mode === 'combo' && (
        <div className="flex justify-center gap-3 mt-6 flex-wrap">
          <div className="bg-white rounded-2xl border-2 border-[#e1e2ed] px-6 py-3">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-wider">Worth alone</p>
            <p className="text-2xl font-black text-gray-800">{fmt(individualValue, currencySymbol)}</p>
          </div>
          <button
            onClick={onSuggest}
            disabled={suggesting}
            className="px-6 py-4 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-500 text-white text-lg font-black flex items-center gap-2 cursor-pointer hover:brightness-105 transition-all disabled:opacity-50"
          >
            {suggesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            ✨ Suggest a price
          </button>
        </div>
      )}

      {/* Giant stepper */}
      <div className="flex items-center justify-center gap-4 mt-8">
        <button
          onClick={() => onValue(Math.max(min, value - step))}
          aria-label="Less"
          className="w-20 h-20 rounded-3xl bg-white border-4 border-[#e1e2ed] hover:border-gray-300 flex items-center justify-center cursor-pointer active:scale-95 transition-all"
        >
          <Minus className="w-9 h-9 text-gray-500" />
        </button>
        <div className="w-48 text-center">
          <p className="text-6xl sm:text-7xl font-black text-gray-900 tabular-nums">
            {value}{discountType === 'percentage' && mode === 'offer' ? '%' : ''}
          </p>
          {mode === 'combo' && <p className="mt-1 text-lg font-bold text-gray-400">{fmt(value, currencySymbol)}</p>}
        </div>
        <button
          onClick={() => onValue(Math.min(max > 0 ? max : 99999, value + step))}
          aria-label="More"
          className="w-20 h-20 rounded-3xl bg-blue-50 border-4 border-blue-200 hover:border-[var(--brand-color)] text-[var(--brand-color)] flex items-center justify-center cursor-pointer active:scale-95 transition-all"
        >
          <Plus className="w-9 h-9" />
        </button>
      </div>

      {picked.length > 0 && mode === 'offer' && (
        <p className="mt-6 text-base text-gray-500">
          {discountType === 'percentage'
            ? `${fmt(Math.max(0, individualValue - individualValue * value / 100), currencySymbol)} off today's value (${fmt(individualValue, currencySymbol)})`
            : `Customers pay ${fmt(Math.max(0, individualValue - value), currencySymbol)} instead of ${fmt(individualValue, currencySymbol)}`}
        </p>
      )}

      <div className="flex gap-3 mt-10 max-w-2xl mx-auto">
        <button onClick={onBack} className="px-6 py-5 rounded-2xl border-2 border-[#e1e2ed] bg-white text-gray-600 text-lg font-black flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={value <= 0}
          className="flex-1 py-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-30"
        >
          See the money <ChevronRight className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 4 — THE MONEY (auto-calculated, plain words, one-tap save)
// ────────────────────────────────────────────────────────────────────
function MoneyScreen({ mode, value, discountType, currencySymbol, picked, preview, previewLoading, previewError, verdict, individualValue, saving, onBack, onSave }: {
  mode: Mode; value: number; discountType: 'percentage' | 'flat'; currencySymbol: string;
  picked: any[]; preview: any | null; previewLoading: boolean; previewError: string;
  verdict: any; individualValue: number; saving: boolean;
  onBack: () => void; onSave: () => void;
}) {
  const rows: any[] = preview?.rows || [];
  const combo = preview?.combo || null;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">
        {mode === 'combo' ? 'Here is the combo money' : 'Here is the money part'}
      </h2>
      <p className="text-center text-base text-gray-400 mt-2">Calculated from your dish costs — an estimate, not an exact number</p>

      {previewLoading && (
        <div className="flex flex-col items-center mt-10 text-gray-500">
          <Loader2 className="w-10 h-10 animate-spin text-[var(--brand-color)] mb-3" />
          <p className="text-lg font-bold">Calculating…</p>
        </div>
      )}

      {!previewLoading && previewError && (
        <div className="mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-center">
          <CircleAlert className="w-8 h-8 text-amber-600 mx-auto mb-2" />
          <p className="text-base font-bold text-amber-800">{previewError}</p>
        </div>
      )}

      {!previewLoading && !previewError && combo && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
            {[
              { label: 'Worth alone', value: fmt(combo.individualValue ?? individualValue, currencySymbol), cls: 'text-gray-900' },
              { label: 'Combo price', value: fmt(combo.comboPrice ?? value, currencySymbol), cls: 'text-[var(--brand-color)]' },
              { label: 'Customers save', value: fmt(combo.customerSavings ?? 0, currencySymbol), cls: 'text-emerald-600' },
              { label: 'You keep', value: fmt(combo.contribution ?? 0, currencySymbol), cls: (combo.contribution ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500' },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-3xl border-2 border-[#e1e2ed] p-4 text-center">
                <p className={`text-2xl font-black ${c.cls}`}>{c.value}</p>
                <p className="mt-1 text-xs font-bold text-gray-400 uppercase tracking-wider">{c.label}</p>
              </div>
            ))}
          </div>
          {combo.withRecipes !== undefined && combo.withRecipes < combo.products && (
            <p className="mt-3 text-center text-sm text-gray-400">
              {combo.withRecipes} of {combo.products} items have dish costs yet — the others can't be estimated.
            </p>
          )}
        </>
      )}

      {!previewLoading && !previewError && mode === 'offer' && rows.length > 0 && (
        <div className="bg-white rounded-3xl border-2 border-[#e1e2ed] mt-8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e1e2ed] flex items-center justify-between">
            <p className="text-base font-black text-gray-800">Dish by dish</p>
            <p className="text-sm text-gray-400">{rows.length} dish{rows.length === 1 ? '' : 'es'}</p>
          </div>
          <div className="divide-y divide-[#e1e2ed]/70">
            {rows.slice(0, 8).map((r: any) => {
              const keep = Number(r.discountedContribution) || 0;
              return (
                <div key={r.productId} className="px-5 py-3.5 flex items-center gap-3">
                  <span className="text-3xl shrink-0" aria-hidden>{emojiFor(r.productName)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-black text-gray-900 truncate">{r.productName}</p>
                    <p className="text-sm text-gray-400">
                      {fmt(r.sellingPrice, currencySymbol)} → <span className="font-bold text-[var(--brand-color)]">{fmt(r.discountedPrice, currencySymbol)}</span>
                      {!r.hasRecipe && ' · no dish cost yet'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-black ${keep >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(keep, currencySymbol)}</p>
                    <p className="text-xs text-gray-400">you keep</p>
                  </div>
                </div>
              );
            })}
            {rows.length > 8 && <p className="px-5 py-3 text-sm text-gray-400">+ {rows.length - 8} more dishes…</p>}
          </div>
        </div>
      )}

      {!previewLoading && !previewError && mode === 'offer' && rows.length === 0 && (
        <div className="mt-8 bg-white rounded-3xl border-2 border-[#e1e2ed] p-6 text-center">
          <p className="text-base text-gray-500">Adding up the dishes… you can still save; costs will fill in as dish costs get added.</p>
        </div>
      )}

      {!previewLoading && verdict && (
        <div className={`mt-5 rounded-2xl border-2 p-4 flex items-center gap-3 ${verdict.bg}`}>
          <span className="text-3xl" aria-hidden>{verdict.emoji}</span>
          <p className={`text-lg font-black ${verdict.tone}`}>{verdict.title}</p>
        </div>
      )}

      <div className="flex gap-3 mt-8">
        <button onClick={onBack} className="px-6 py-5 rounded-2xl border-2 border-[#e1e2ed] bg-white text-gray-600 text-lg font-black flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 py-6 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-2xl font-black flex items-center justify-center gap-3 cursor-pointer transition-colors disabled:opacity-40 shadow-lg"
        >
          {saving ? <Loader2 className="w-8 h-8 animate-spin" /> : <Check className="w-8 h-8" />}
          {saving ? 'Saving…' : 'Turn it on ✅'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 5 — DONE
// ────────────────────────────────────────────────────────────────────
function DoneScreen({ title, onAgain, onClose }: { title: string; onAgain: () => void; onClose: () => void }) {
  return (
    <div className="max-w-xl mx-auto text-center mt-10">
      <div className="w-28 h-28 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
        <PartyPopper className="w-14 h-14 text-emerald-500" />
      </div>
      <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mt-6">Done! 🎉</h2>
      <p className="text-xl text-gray-500 mt-3 font-semibold">
        “{title}” is now live for your customers.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 mt-8 justify-center">
        <button onClick={onAgain} className="py-5 px-8 rounded-2xl bg-[var(--brand-color)] text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-[#003ea8] transition-colors">
          <Plus className="w-6 h-6" /> Make another
        </button>
        <button onClick={onClose} className="py-5 px-8 rounded-2xl border-2 border-[#e1e2ed] bg-white text-gray-700 text-xl font-black cursor-pointer hover:bg-gray-50 transition-colors">
          Done
        </button>
      </div>
    </div>
  );
}

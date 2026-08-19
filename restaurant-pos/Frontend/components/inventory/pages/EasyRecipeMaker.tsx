/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EasyRecipeMaker — the "anyone can use it" recipe wizard.
 *
 * Built for people who should never need to read a POS manual: a child, an
 * elderly owner, or someone who cannot read much. Everything is designed for
 * that person:
 *
 *   - ONE question per screen (never a form).
 *   - Giant touch targets (≥56px) and large type everywhere.
 *   - Voice-first: "tap the mic and say how the dish is made".
 *   - Plain words + emoji + colour instead of accounting terms
 *     ("Cost to make", "You sell for", "You keep" — not "estimated variable
 *     cost" or "contribution margin").
 *   - One-tap confirm. Nothing is saved until the big green button is pressed.
 *
 * Under the hood it ONLY reuses existing, tested pieces:
 *   - POST /recipes/ai/quick-create  (LLM → Zod → tenant-scoped matching)
 *   - POST /recipes/ai/search        (manual resolution of uncertain items)
 *   - POST /voice-inventory/transcribe (existing Groq Whisper, hi-en)
 *   - POST /recipes                  (deterministic save; server computes cost)
 *   - GET  /cost-settings            (restaurant allowances for the preview)
 *
 * All money shown before saving is a CLIENT preview mirroring the backend
 * engine; the backend is authoritative (the saved recipe carries costSummary).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Mic, Sparkles, Check, ChevronLeft, ChevronRight, Plus, Minus,
  Search, Loader2, CircleAlert, RefreshCw, PartyPopper, Utensils,
} from 'lucide-react';
import { useInventory } from '../InventoryManager';
import {
  fetchProducts, recipeAiQuickCreate, recipeAiSearchInventory,
  createRecipe, fetchCostSettings,
} from '../../../src/api/client';
import apiClient from '../../../src/api/axios';

// ─── Tiny unit mirror (kg↔g↔mg, L↔ml, pcs) — display only; server is truth ──
const UNIT_FAMILY: Record<string, { family: string; factor: number }> = {
  kg: { family: 'mass', factor: 1000 }, g: { family: 'mass', factor: 1 },
  gram: { family: 'mass', factor: 1 }, grams: { family: 'mass', factor: 1 },
  gm: { family: 'mass', factor: 1 }, mg: { family: 'mass', factor: 0.001 },
  l: { family: 'volume', factor: 1000 }, litre: { family: 'volume', factor: 1000 },
  liters: { family: 'volume', factor: 1000 }, ml: { family: 'volume', factor: 1 },
  pcs: { family: 'count', factor: 1 }, pc: { family: 'count', factor: 1 },
  piece: { family: 'count', factor: 1 }, pieces: { family: 'count', factor: 1 },
  nos: { family: 'count', factor: 1 }, no: { family: 'count', factor: 1 },
  unit: { family: 'count', factor: 1 }, units: { family: 'count', factor: 1 },
  plate: { family: 'count', factor: 1 }, plates: { family: 'count', factor: 1 },
  serving: { family: 'count', factor: 1 }, servings: { family: 'count', factor: 1 },
};
const normUnit = (u?: string) => (u || '').trim().toLowerCase();
const conv = (qty: number, from: string, to: string): number => {
  const a = UNIT_FAMILY[normUnit(from)];
  const b = UNIT_FAMILY[normUnit(to)];
  // Incompatible/unknown units → NaN (callers flag the row for review). Never
  // silently pass through — the backend rejects mismatches with an error.
  if (!a || !b || a.family !== b.family) return NaN;
  return Math.round((qty * a.factor) / b.factor * 10000) / 10000;
};
const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtSmall = (n: number) => '₹' + money(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const prettyQty = (n: number) => String(Math.round(n * 100) / 100);

// Item thumbnail — shows the item's REAL photo whenever one exists, otherwise
// its initial letter (same fallback as the billing menu). Never a food emoji:
// the photo is the source of truth for what the item is.
// (exported so the Easy Offer Maker reuses the same visual language)
export function ItemThumb({ item, size = 'md' }: { item: any; size?: 'sm' | 'md' | 'lg' }) {
  const name = item?.name || item?.itemName || item?.ingredientText || '?';
  const box = size === 'lg'
    ? 'w-16 h-16 sm:w-20 sm:h-20 rounded-2xl text-2xl sm:text-3xl'
    : size === 'sm'
      ? 'w-9 h-9 rounded-lg text-sm'
      : 'w-11 h-11 rounded-xl text-lg';
  return (
    <span className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden bg-gray-100 ${box}`} aria-hidden>
      <span className="font-black text-gray-400 select-none">{String(name).charAt(0).toUpperCase()}</span>
      {item?.image && (
        <img
          src={item.image}
          alt={name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
    </span>
  );
}

type Step = 'pick' | 'how' | 'check' | 'money' | 'done';

interface Row {
  key: string;
  ingredientText: string;      // what the person said / the item name
  inventoryItemId?: string;
  itemName?: string;           // resolved inventory item name (may differ)
  unit: string;                // the unit the displayed quantity is IN (what we save)
  quantity: number;
  itemUnit?: string;           // inventory item's tracking unit (display only)
  averageCost?: number;        // inventory weighted-average cost
  costPreview?: number;        // deterministic qty × avgCost (₹) at draft time
  costPerUnit?: number;        // ₹ per inventory unit (used to re-price on qty change)
  baseQuantity?: number;       // quantity the AI draft's costPreview was computed for
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  needsReview: boolean;        // must be confirmed before saving
  reason?: string;
  manual?: boolean;            // added by tapping tiles (not AI)
  image?: string;              // real product photo (shown instead of an emoji)
}

const uid = () => `r${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ─── Quantity sanity check (never silently changes anything) ───────
// A single serving of a dish is unlikely to contain more than ~500g, ~500ml
// or ~10 pieces of one ingredient. When AI suggests something far bigger we
// ask the person — "is it really 2kg of paneer?" — and never change it alone.
function flagUnusual(row: Row): boolean {
  const q = Math.abs(Number(row.quantity) || 0);
  if (q === 0) return false;
  const u = normUnit(row.unit || row.itemUnit);
  const fam = UNIT_FAMILY[u]?.family;
  if (fam === 'mass') return q > 500; // grams
  if (fam === 'volume') return q > 500; // ml
  return q > 10; // pieces
}

/** Deterministic line cost for one row (client preview — server is truth).
 *  Re-prices whenever the quantity/unit changes, using the item's ₹/unit when
 *  known, else scaling the AI draft's backend-computed costPreview linearly. */
function lineCostOf(r: Row): number {
  const qty = Number(r.quantity) || 0;
  if (qty <= 0) return 0;
  if (r.costPerUnit !== undefined && Number.isFinite(r.costPerUnit)) {
    const inItem = conv(qty, r.unit, r.itemUnit || r.unit);
    if (Number.isFinite(inItem) && inItem > 0) return money(inItem * r.costPerUnit);
  }
  if (r.costPreview !== undefined && r.baseQuantity !== undefined && r.baseQuantity > 0) {
    return money((r.costPreview || 0) * (qty / r.baseQuantity));
  }
  return money(r.costPreview || 0);
}

/** Shared money math for the Check + Money screens (layered model preview). */
function useWizardMath(rows: Row[], settings: any | null) {
  return useMemo(() => {
    const direct = money(rows.reduce((s, r) => s + lineCostOf(r), 0));
    const minor = money(Number(settings?.minorIngredientAllowance) || 0);
    const cooking = money(Number(settings?.cookingAllowance) || 0);
    const packaging = money(Number(settings?.packaging?.dineIn) || 0);
    const wastage = money((direct + minor + cooking) * ((Number(settings?.wastagePercent) || 0) / 100));
    const variable = money(direct + minor + cooking + wastage + packaging);
    return { direct, minor, cooking, wastage, packaging, variable };
  }, [rows, settings]);
}

interface Props {
  onClose: () => void;
  /** Optional hook to refresh the recipe list after a save. */
  onSaved?: () => void;
  /** Pre-select a product so the user skips the pick step. */
  initialProduct?: any | null;
}

export default function EasyRecipeMaker({ onClose, onSaved, initialProduct }: Props) {
  const { items: inventoryItems } = useInventory();

  const [step, setStep] = useState<Step>(initialProduct ? 'how' : 'pick');
  const [products, setProducts] = useState<any[] | null>(null);
  const [product, setProduct] = useState<any | null>(initialProduct || null);
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCost, setSavedCost] = useState<any | null>(null);
  const [fatal, setFatal] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<string>('');

  // Load the menu once — big tappable dish cards are the first question.
  useEffect(() => {
    let alive = true;
    Promise.all([fetchProducts(), fetchCostSettings()])
      .then(([prods, cs]) => {
        if (!alive) return;
        const menu = Array.isArray(prods)
          ? prods.filter((p: any) => p && p.availability !== false && !p.isDeleted && (Number(p.price) || 0) > 0)
          : [];
        setProducts(menu);
        setSettings(cs || null);
      })
      .catch(() => { if (alive) setFatal('Could not reach the server. Check the connection and try again.'); });
    return () => { alive = false; };
  }, []);

  const go = (s: Step) => { setStep(s); window.scrollTo?.({ top: 0 }); };

  const nextFromCheck = () => go('money');

  // ─── Save (deterministic backend — one tap) ──────────────────────
  const handleSave = async () => {
    if (!product || rows.length === 0 || saving) return;
    setSaving(true);
    try {
      const components = rows
        .filter((r) => r.inventoryItemId)
        .map((r) => ({
          inventoryItemId: r.inventoryItemId,
          itemName: r.itemName || r.ingredientText,
          // quantity is expressed in r.unit (the unit shown on screen). The
          // backend engine converts it into the item's own unit — sending the
          // item's unit here with the spoken quantity would multiply 1000×.
          unit: r.unit || r.itemUnit || 'g',
          quantity: Math.max(0, Number(r.quantity) || 0),
          wastagePercent: 0,
          optional: false,
        }));
      const saved = await createRecipe({
        productId: product._id,
        variantName: selectedVariant || undefined,
        name: `${product.name}${selectedVariant ? ` (${selectedVariant})` : ''} Recipe`,
        yieldQuantity: 1,
        yieldUnit: 'plate',
        servingSize: 1,
        components,
        status: 'active',
      });
      if (!saved) { setFatal('Save failed — check the connection and try again.'); return; }
      setSavedCost(saved.costSummary || saved);
      onSaved?.();
      go('done');
    } catch (e: any) {
      setFatal(e?.message || 'Save failed — check the connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[250] bg-[var(--color-bg-page)] flex flex-col"
      role="dialog"
      aria-label="Easy recipe maker"
    >
      {/* Top bar — big and friendly */}
      <div className="bg-[var(--color-sidebar-bg)] text-white px-4 sm:px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl" aria-hidden>👨‍🍳</span>
          <span className="text-lg sm:text-xl font-black tracking-tight">Easy Recipe Maker</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Progress dots — picture language, no words */}
      <div className="flex items-center justify-center gap-3 sm:gap-6 py-3 shrink-0">
        {[
          { id: 'pick' as Step, icon: '🍽️', label: 'Pick a dish' },
          { id: 'how' as Step, icon: '🎤', label: 'Say or add' },
          { id: 'check' as Step, icon: '✅', label: 'Check' },
          { id: 'money' as Step, icon: '💰', label: 'Money' },
        ].map((s, i) => {
          const done = step === 'done' || (['pick', 'how', 'check', 'money'].indexOf(step) > i);
          const active = step === s.id;
          return (
            <div key={s.id} className="flex items-center gap-3 sm:gap-6">
              {i > 0 && <div className={`w-8 sm:w-14 h-1.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-gray-200'}`} aria-hidden />}
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-2xl border-2 transition-all ${
                    active ? 'border-[var(--brand-color)] bg-blue-50 scale-110 shadow-md'
                      : done ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-[var(--color-bg-white)]'
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

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-10">
        {fatal && (
          <div className="max-w-xl mx-auto mt-10 bg-[var(--color-bg-white)] rounded-3xl border border-red-200 p-8 text-center">
            <CircleAlert className="w-14 h-14 text-red-400 mx-auto mb-4" />
            <p className="text-xl font-bold text-gray-800">{fatal}</p>
            <button
              onClick={onClose}
              className="mt-6 w-full max-w-xs mx-auto block py-4 rounded-2xl bg-[var(--color-sidebar-bg)] text-white text-lg font-black cursor-pointer hover:bg-black transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {!fatal && step === 'pick' && (
          <PickDish
            products={products}
            onPick={(p) => {
              // Check if a specific variant was selected (from variant buttons)
              const variantName = (p as any)._selectedVariant || '';
              const cleanProduct = variantName ? { ...p, _selectedVariant: undefined } : p;
              setProduct(cleanProduct);
              setSelectedVariant(variantName);
              setRows([]);
              go('how');
            }}
            onClose={onClose}
          />
        )}

        {!fatal && step === 'how' && product && (
          <HowScreen
            product={product}
            inventoryItems={inventoryItems}
            onRows={(newRows) => { setRows(newRows); go('check'); }}
            selectedVariant={selectedVariant}
          />
        )}

        {!fatal && step === 'check' && product && (
          <CheckScreen
            product={product}
            rows={rows}
            settings={settings}
            onRows={setRows}
            onBack={() => go('how')}
            onNext={nextFromCheck}
          />
        )}

        {!fatal && step === 'money' && product && (
          <MoneyScreen
            product={product}
            rows={rows}
            settings={settings}
            saving={saving}
            onBack={() => go('check')}
            onSave={() => void handleSave()}
          />
        )}

        {!fatal && step === 'done' && product && (
          <DoneScreen
            product={product}
            savedCost={savedCost}
            onAgain={() => { setProduct(null); setRows([]); setSavedCost(null); setSelectedVariant(''); setStep('pick'); }}
            onClose={onClose}
            selectedVariant={selectedVariant}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 1 — PICK A DISH
// ────────────────────────────────────────────────────────────────────
function PickDish({ products, onPick, onClose }: {
  products: any[] | null;
  onPick: (p: any) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = products || [];
    if (!needle) return base;
    return base.filter((p) => (p.name || '').toLowerCase().includes(needle));
  }, [products, q]);

  if (products === null) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center">
        <Loader2 className="w-14 h-14 animate-spin text-[var(--brand-color)] mx-auto mb-4" />
        <p className="text-xl font-bold text-gray-500">Loading your dishes…</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-[var(--color-bg-white)] rounded-3xl border border-[var(--color-border-default)] p-8 text-center">
        <Utensils className="w-14 h-14 text-gray-300 mx-auto mb-4" />
        <p className="text-xl font-bold text-gray-700">No dishes on the menu yet</p>
        <p className="text-base text-gray-400 mt-2">Add your dishes in the Products screen first, then come back here.</p>
        <button onClick={onClose} className="mt-6 w-full max-w-xs mx-auto block py-4 rounded-2xl bg-[var(--brand-color)] text-white text-lg font-black cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors">
          OK, close
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">What dish are we making?</h2>
      <p className="text-center text-base text-gray-400 mt-2">Tap a dish below</p>

      <div className="relative mt-6 max-w-lg mx-auto">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your dishes…"
          aria-label="Search dishes"
          className="w-full pl-14 pr-4 py-4 rounded-2xl border-2 border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-[var(--brand-color)]/20"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mt-6">
        {list.map((p) => {
          const variants = (p.variants || []) as Array<{ name: string; price?: number }>;
          const hasVariants = variants.length > 0;
          return (
            <div key={p._id} className="bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] overflow-hidden">
              <button
                onClick={() => onPick(p)}
                className="w-full hover:border-[var(--brand-color)] hover:shadow-lg active:scale-[0.98] transition-all p-4 sm:p-5 flex flex-col items-center cursor-pointer"
              >
                <ItemThumb item={p} size="lg" />
                <span className="mt-3 text-base sm:text-lg font-black text-gray-900 text-center leading-tight">{p.name}</span>
                <span className="mt-1.5 text-lg font-black text-[var(--brand-color)]">{fmt(Number(p.price) || 0)}</span>
              </button>
              {/* Variant buttons — tap to pick a specific variant */}
              {hasVariants && (
                <div className="px-3 pb-3 space-y-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 text-center">Variants</p>
                  <div className="flex flex-wrap gap-1 justify-center">
                    <button
                      onClick={() => onPick(p)}
                      className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-blue-50 text-[10px] font-bold text-gray-600 hover:text-[var(--brand-color)] transition-all cursor-pointer"
                    >
                      Base
                    </button>
                    {variants.map((v) => (
                      <button
                        key={v.name}
                        onClick={() => onPick({ ...p, _selectedVariant: v.name })}
                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-blue-50 text-[10px] font-bold text-gray-600 hover:text-[var(--brand-color)] transition-all cursor-pointer"
                      >
                        {v.name}{v.price ? ` ₹${v.price}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="col-span-full text-center py-10 text-lg text-gray-400">No dish named “{q}” — check the spelling.</div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 2 — HOW IS IT MADE?  (voice-first, tap-to-add fallback)
// ────────────────────────────────────────────────────────────────────
function HowScreen({ product, inventoryItems, onRows, selectedVariant }: {
  product: any;
  inventoryItems: any[];
  onRows: (rows: Row[]) => void;
  selectedVariant?: string;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [manual, setManual] = useState<Row[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);

  // Stop any recording if the person leaves this screen.
  useEffect(() => () => {
    if (recRef.current) recRef.current.abort();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
  }, []);

  const stopMic = useCallback(() => {
    if (recRef.current) { recRef.current.abort(); recRef.current = null; }
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  // MediaRecorder → backend Groq Whisper (Electron / browsers without Web Speech).
  const recordMedia = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not available here — type below or tap “add one by one”.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try { audioCtxRef.current?.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
        if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setRecording(false);
        if (blob.size < 8000) { setError('No speech heard — try again or type it.'); return; }
        setTranscribing(true);
        setError('');
        try {
          const { data } = await apiClient.post('/voice-inventory/transcribe', {
            audio: await blobToBase64(blob),
            audioMimeType: blob.type || 'audio/webm',
            language: 'hi-en',
          });
          const transcript = data?.transcript;
          if (!data?.success || !transcript) throw new Error(data?.error || 'No speech detected');
          setText(transcript);
          void extract(transcript);
        } catch (e: any) {
          setError(e?.response?.data?.error || e?.message || 'Could not hear you — try typing instead.');
        } finally {
          setTranscribing(false);
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setError('Recording failed — type below instead.');
      };
      recorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start();
      setRecording(true);
      setError('');
      startRef.current = Date.now();
      // Hard cap 20s — nobody should be stuck talking forever.
      timerRef.current = window.setInterval(() => {
        if (Date.now() - startRef.current >= 20000) stopMic();
      }, 500);
    } catch (e: any) {
      setRecording(false);
      setError(`Microphone blocked (${e?.name || 'error'}) — type below instead.`);
    }
  }, [stopMic]);

  // Web Speech API where available — cheaper and faster.
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || (window as any).electronAPI) { void recordMedia(); return; }
    const rec = new SR();
    rec.lang = 'hi-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(t);
      setRecording(false);
      void extract(t);
    };
    rec.onerror = (e: any) => {
      setRecording(false);
      if (e?.error === 'no-speech') { setError('No speech heard — try again.'); return; }
      if (e?.error === 'not-allowed' || e?.error === 'network') { void recordMedia(); return; }
      setError('Voice failed — type below instead.');
    };
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
    setError('');
  }, [recordMedia]);

  // AI → reviewable rows (never saves anything).
  const extract = useCallback(async (input: string) => {
    const trimmed = (input || '').trim();
    if (trimmed.length < 3) { setError('Say or type at least one ingredient, like “200g paneer, 150g tomato”.'); return; }
    setLoading(true);
    setError('');
    try {
      const draft = await recipeAiQuickCreate(product._id, trimmed);
      if (!draft) { setError('Could not reach the AI — add the ingredients one by one instead.'); return; }
      const rows: Row[] = [];
      const withPricing = (m: any): Partial<Row> => {
        const itemUnit = m.itemUnit || 'g';
        const inItem = conv(m.quantity, m.unit || m.itemUnit, itemUnit);
        return {
          costPerUnit: Number.isFinite(inItem) && inItem > 0 && m.costPreview !== undefined
            ? money((m.costPreview || 0) / inItem)
            : undefined,
          baseQuantity: Number(m.quantity) || 1,
        };
      };
      const imgOf = (id?: string) => (inventoryItems || []).find((i) => String(i.id) === String(id))?.image || '';
      for (const m of (draft.matched || [])) {
        rows.push({
          key: uid(), ingredientText: m.ingredientText, inventoryItemId: m.inventoryItemId,
          itemName: m.itemName || m.ingredientText, unit: m.unit, quantity: Number(m.quantity) || 0,
          itemUnit: m.itemUnit, costPreview: m.costPreview,
          confidence: m.confidence, needsReview: false, image: imgOf(m.inventoryItemId),
          ...withPricing(m),
        });
      }
      for (const n of (draft.needsAttention || [])) {
        rows.push({
          key: uid(), ingredientText: n.ingredientText, inventoryItemId: n.inventoryItemId,
          itemName: n.itemName || n.ingredientText, unit: n.unit, quantity: Number(n.quantity) || 0,
          itemUnit: n.itemUnit, costPreview: n.costPreview, confidence: n.confidence,
          needsReview: true, reason: n.reason, image: imgOf(n.inventoryItemId),
          ...withPricing(n),
        });
      }
      if (rows.length === 0) {
        setError('I could not pick out any ingredients — add them one by one below.');
        return;
      }
      // Merge with anything added by hand earlier.
      onRows([...manual, ...rows]);
    } catch (e: any) {
      setError(e?.message || 'AI is busy right now — add the ingredients one by one below.');
    } finally {
      setLoading(false);
    }
  }, [product._id, manual, onRows]);

  // ─── Tap-to-add picker state ──────────────────────────────────────
  const [pickQ, setPickQ] = useState('');
  const pickList = useMemo(() => {
    const needle = pickQ.trim().toLowerCase();
    const base = (inventoryItems || []).filter((i) => i && i.id && i.name);
    if (!needle) return base.slice(0, 60);
    return base.filter((i) => i.name.toLowerCase().includes(needle)).slice(0, 60);
  }, [inventoryItems, pickQ]);

  const addManual = (item: any) => {
    setManual((prev) => [...prev, {
      key: uid(), ingredientText: item.name, inventoryItemId: item.id,
      itemName: item.name, unit: item.unit || 'g', quantity: 1,
      itemUnit: item.unit || 'g', averageCost: Number(item.averageCost) || 0,
      costPerUnit: Number(item.averageCost) || 0,
      costPreview: Number(item.averageCost) || 0, needsReview: false, manual: true,
      image: item.image || '',
    }]);
  };
  const bumpManual = (key: string, delta: number) => {
    setManual((prev) => prev.map((r) => r.key === key ? { ...r, quantity: Math.max(0.5, (Number(r.quantity) || 1) + delta) } : r));
  };
  const dropManual = (key: string) => setManual((prev) => prev.filter((r) => r.key !== key));

  const readyToGo = (manual.length > 0) || text.trim().length >= 3;

  // Next: parse any typed text (so it is never silently dropped), else use
  // the hand-picked rows. extract() navigates to Check only on success.
  const next = () => {
    if (text.trim().length >= 3) { void extract(text); return; }
    if (manual.length > 0) onRows(manual);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">
        What goes inside <span className="text-[var(--brand-color)]">{product.name}</span>{selectedVariant ? <span className="text-lg text-gray-500 ml-2">({selectedVariant})</span> : ''}?
      </h2>
      <p className="text-center text-base text-gray-400 mt-2">“200 gram paneer, 150 gram tomato, 30 gram butter”</p>

      {/* The big voice button */}
      <div className="flex flex-col items-center mt-8">
        <button
          onClick={recording || transcribing ? stopMic : startListening}
          aria-label={recording ? 'Stop recording' : 'Say the ingredients'}
          className={`w-40 h-40 sm:w-48 sm:h-48 rounded-full flex flex-col items-center justify-center gap-2 transition-all cursor-pointer shadow-xl ${
            recording
              ? 'bg-[var(--color-red-500-solid)] text-white scale-105 animate-pulse'
              : 'bg-[var(--brand-color)] text-white hover:bg-[var(--color-primary-hover)] active:scale-95'
          }`}
        >
          {recording ? (
            <span className="text-6xl" aria-hidden>⏹️</span>
          ) : (
            <Mic className="w-16 h-16" />
          )}
          <span className="text-lg font-black px-4">
            {recording ? 'Stop' : transcribing ? 'Listening…' : 'Tap & say'}
          </span>
        </button>
        {transcribing && (
          <p className="mt-4 text-base text-gray-500 flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Writing what you said…
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 my-6" aria-hidden>
        <div className="flex-1 h-0.5 bg-gray-200" />
        <span className="text-sm font-bold text-gray-400">or</span>
        <div className="flex-1 h-0.5 bg-gray-200" />
      </div>

      {/* Typed text + AI */}
      <div className="bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] p-4 sm:p-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Type it — “200g paneer, 150g tomato, 30g butter, 40ml cream”"
          aria-label="Type the ingredients"
          className="w-full text-lg leading-relaxed p-3 rounded-2xl bg-gray-50 border border-[var(--color-border-default)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-color)]/20 resize-none"
        />
        <button
          onClick={() => void extract(text)}
          disabled={loading || text.trim().length < 3}
          className="mt-3 w-full py-4 rounded-2xl bg-[var(--brand-color)] text-white text-lg font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
          {loading ? 'Thinking…' : '✨ Make it'}
        </button>
        {error && (
          <p className="mt-3 text-base font-semibold text-red-600 flex items-start gap-2">
            <CircleAlert className="w-5 h-5 shrink-0 mt-0.5" /> {error}
          </p>
        )}
      </div>

      {/* Tap-to-add fallback */}
      <button
        onClick={() => setShowPicker((s) => !s)}
        className="mt-4 w-full py-4 rounded-2xl border-2 border-dashed border-[var(--brand-color)] text-[var(--brand-color)] text-lg font-black cursor-pointer hover:bg-blue-50 transition-colors"
      >
        {showPicker ? 'Hide the list' : '👆 Add one by one from the list'}
      </button>

      {showPicker && (
        <div className="mt-4 bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] p-4">
          <div className="relative mb-3">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
              placeholder="Find an ingredient…"
              aria-label="Find an ingredient"
              className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-gray-50 border border-[var(--color-border-default)] text-base font-semibold focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {pickList.map((i) => (
              <button
                key={i.id}
                onClick={() => addManual(i)}
                className="rounded-2xl border-2 border-[var(--color-border-default)] hover:border-[var(--brand-color)] bg-[var(--color-bg-white)] p-3 text-left cursor-pointer active:scale-[0.97] transition-all"
              >
                <ItemThumb item={i} size="sm" />
                <span className="block text-sm font-bold text-gray-800 leading-tight mt-1">{i.name}</span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  {fmtSmall(Number(i.averageCost) || 0)} / {i.unit}
                </span>
              </button>
            ))}
            {pickList.length === 0 && <p className="col-span-full text-center py-6 text-gray-400">Nothing found — tap the mic instead, or add the item to inventory first.</p>}
          </div>
        </div>
      )}

      {/* Hand-picked rows with big steppers */}
      {manual.length > 0 && (
        <div className="mt-5 space-y-2.5">
          {manual.map((r) => (
            <div key={r.key} className="bg-[var(--color-bg-white)] rounded-2xl border-2 border-[var(--color-border-default)] p-3 flex items-center gap-3">
              <ItemThumb item={r} />
              <div className="flex-1 min-w-0">
                <p className="text-base font-black text-gray-900 truncate">{r.itemName}</p>
                <p className="text-sm text-gray-400">{fmtSmall(r.costPreview || 0)} each</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => bumpManual(r.key, -1)} aria-label="Less" className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer">
                  <Minus className="w-5 h-5" />
                </button>
                <span className="w-14 text-center text-xl font-black text-gray-900">{prettyQty(r.quantity)}</span>
                <button onClick={() => bumpManual(r.key, 1)} aria-label="More" className="w-12 h-12 rounded-xl bg-blue-50 hover:bg-blue-100 text-[var(--brand-color)] flex items-center justify-center cursor-pointer">
                  <Plus className="w-5 h-5" />
                </button>
                <button onClick={() => dropManual(r.key)} aria-label="Remove" className="w-12 h-12 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center cursor-pointer ml-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Next */}
      <div className="flex justify-center mt-8">
        <button
          onClick={next}
          disabled={!readyToGo}
          className="w-full max-w-sm py-5 rounded-2xl bg-[var(--color-emerald-500-solid)] text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--color-emerald-600-solid)] transition-colors disabled:opacity-30"
        >
          Next <ChevronRight className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 3 — CHECK (one tap per row; uncertain rows ask for a choice)
// ────────────────────────────────────────────────────────────────────
function CheckScreen({ product, rows, settings, onRows, onBack, onNext }: {
  product: any;
  rows: Row[];
  settings: any | null;
  onRows: (r: Row[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [searching, setSearching] = useState<string | null>(null);
  const [hits, setHits] = useState<any[]>([]);
  const [hitQ, setHitQ] = useState('');

  const update = (key: string, patch: Partial<Row>) => onRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const bump = (key: string, delta: number) => onRows(rows.map((r) => r.key === key ? { ...r, quantity: Math.max(0.5, (Number(r.quantity) || 0) + delta) } : r));
  const drop = (key: string) => onRows(rows.filter((r) => r.key !== key));

  const pickSearch = async (key: string, q: string) => {
    setSearching(key);
    setHitQ(q);
    try {
      const res = await recipeAiSearchInventory(q);
      setHits(res || []);
    } finally {
      setSearching(null);
    }
  };

  const choose = (key: string, item: any) => {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const itemUnit = item.unit || 'g';
    // The displayed quantity is in row.unit — convert it into the new item's
    // unit and relabel, so the saved quantity/unit pair stays self-consistent.
    const qty = conv(row.quantity, row.unit || row.itemUnit || 'g', itemUnit);
    if (!Number.isFinite(qty)) {
      // Incompatible units (kg vs pcs…) — keep it flagged, never guess.
      update(key, {
        inventoryItemId: item._id || item.id, itemName: item.name, itemUnit,
        averageCost: Number(item.averageCost) || 0, image: item.image || '',
        needsReview: true, reason: `Units don't match — this item is tracked in ${itemUnit}.`,
      });
    } else {
      update(key, {
        inventoryItemId: item._id || item.id, itemName: item.name, itemUnit,
        averageCost: Number(item.averageCost) || 0, image: item.image || '',
        costPerUnit: money(Number(item.averageCost) || 0),
        needsReview: false, reason: undefined,
        quantity: qty > 0 ? qty : row.quantity, unit: itemUnit,
      });
    }
    setHits([]);
    setHitQ('');
  };

  const { variable } = useWizardMath(rows, settings);

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">Is this right?</h2>
      <p className="text-center text-base text-gray-400 mt-2">
        {product.name} · tap anything to change it
      </p>

      <div className="space-y-2.5 mt-6">
        {rows.map((r) => (
          <div
            key={r.key}
            className={`rounded-2xl border-2 p-3 sm:p-4 ${r.needsReview ? 'border-amber-300 bg-amber-50' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)]'}`}
          >
            <div className="flex items-center gap-3">
              <ItemThumb item={r} />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-black text-gray-900 truncate">{r.itemName || r.ingredientText}</p>
                <p className="text-sm text-gray-400 truncate">
                  {r.itemUnit ? `tracked in ${r.itemUnit}` : 'not matched yet'}
                  {r.averageCost !== undefined && r.averageCost > 0 ? ` · ${fmtSmall(r.averageCost)} / ${r.itemUnit}` : ''}
                </p>
                {r.needsReview && r.reason && (
                  <p className="text-sm font-semibold text-amber-700 flex items-start gap-1.5 mt-1">
                    <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" /> {r.reason}
                  </p>
                )}
                {flagUnusual(r) && (
                  <p className="text-sm font-semibold text-amber-700 flex items-start gap-1.5 mt-1">
                    <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" /> That looks like a lot — is it really {prettyQty(r.quantity)} {r.unit}?
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-black text-gray-900">{fmtSmall(lineCostOf(r))}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl p-1 border border-[var(--color-border-default)]">
                <button onClick={() => bump(r.key, -1)} aria-label="Less" className="w-11 h-11 rounded-lg bg-[var(--color-bg-white)] hover:bg-gray-100 border border-[var(--color-border-default)] flex items-center justify-center cursor-pointer">
                  <Minus className="w-4.5 h-4.5" />
                </button>
                <span className="w-16 text-center text-lg font-black text-gray-900">
                  {prettyQty(r.quantity)} {r.unit}
                </span>
                <button onClick={() => bump(r.key, 1)} aria-label="More" className="w-11 h-11 rounded-lg bg-[var(--color-bg-white)] hover:bg-gray-100 border border-[var(--color-border-default)] flex items-center justify-center cursor-pointer">
                  <Plus className="w-4.5 h-4.5" />
                </button>
              </div>
              <button
                onClick={() => pickSearch(r.key, r.ingredientText)}
                disabled={searching === r.key}
                className="px-4 h-12 rounded-xl bg-blue-50 hover:bg-blue-100 text-[var(--brand-color)] font-black text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {searching === r.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Change
              </button>
              <button onClick={() => drop(r.key)} aria-label="Remove ingredient" className="ml-auto w-12 h-12 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {searching === r.key && (
              <div className="mt-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                  <input
                    value={hitQ}
                    onChange={(e) => setHitQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void pickSearch(r.key, hitQ); }}
                    placeholder="Search your inventory…"
                    aria-label="Search inventory to replace this ingredient"
                    className="w-full pl-11 pr-3 py-3 rounded-xl bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-base font-semibold focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                  {hits.map((h) => (
                    <button
                      key={h._id || h.id}
                      onClick={() => choose(r.key, h)}
                      className="rounded-xl border-2 border-[var(--color-border-default)] hover:border-emerald-400 bg-[var(--color-bg-white)] p-3 text-left cursor-pointer active:scale-[0.98] transition-all flex items-center gap-2.5"
                    >
                      <ItemThumb item={h} size="sm" />
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-gray-800 truncate">{h.name}</span>
                        <span className="block text-xs text-gray-400">{fmtSmall(Number(h.averageCost) || 0)} / {h.unit}</span>
                      </span>
                    </button>
                  ))}
                  {hits.length === 0 && !searching && <p className="col-span-full text-center py-4 text-gray-400">No matches — type a different name.</p>}
                </div>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-center py-10">
            <p className="text-lg text-gray-400">No ingredients yet — go back and add some.</p>
            <button onClick={onBack} className="mt-4 px-6 py-3 rounded-2xl bg-[var(--brand-color)] text-white font-black cursor-pointer">← Go back</button>
          </div>
        )}
      </div>

      {/* Mini cost line so they know what's coming */}
      <div className="mt-6 bg-[var(--color-sidebar-bg)] rounded-2xl p-4 flex items-center justify-between text-white">
        <span className="text-lg font-bold text-white/70">Cost to make</span>
        <span className="text-2xl font-black">{fmtSmall(variable)}</span>
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onBack} className="px-6 py-5 rounded-2xl border-2 border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-gray-600 text-lg font-black flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={rows.filter((r) => r.inventoryItemId).length === 0}
          className="flex-1 py-5 rounded-2xl bg-[var(--color-emerald-500-solid)] text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--color-emerald-600-solid)] transition-colors disabled:opacity-30"
        >
          Looks good <ChevronRight className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 4 — THE MONEY (plain words + colour, one-tap save)
// ────────────────────────────────────────────────────────────────────
function MoneyScreen({ product, rows, settings, saving, onBack, onSave }: {
  product: any;
  rows: Row[];
  settings: any | null;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const price = Number(product.price) || 0;
  const { variable } = useWizardMath(rows, settings);
  const keep = money(price - variable);
  const margin = price > 0 ? keep / price * 100 : 0;

  const verdict = keep < 0
    ? { emoji: '😟', title: 'You lose money on this dish', tone: 'text-red-600', bg: 'bg-red-50 border-red-300' }
    : margin < 20
      ? { emoji: '😕', title: 'You keep very little', tone: 'text-amber-600', bg: 'bg-amber-50 border-amber-300' }
      : { emoji: '😊', title: 'Great! You keep a good amount', tone: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300' };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-center text-2xl sm:text-3xl font-black text-gray-900 mt-2">Here is the money part</h2>
      <p className="text-center text-base text-gray-400 mt-2">{product.name} · this is an estimate, not an exact number</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8">
        <div className="bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] p-5 text-center">
          <span className="text-4xl" aria-hidden>🧾</span>
          <p className="mt-2 text-sm font-bold text-gray-400 uppercase tracking-wider">Cost to make</p>
          <p className="text-3xl font-black text-gray-900 mt-1">{fmtSmall(variable)}</p>
        </div>
        <div className="bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] p-5 text-center">
          <span className="text-4xl" aria-hidden>🏷️</span>
          <p className="mt-2 text-sm font-bold text-gray-400 uppercase tracking-wider">You sell for</p>
          <p className="text-3xl font-black text-[var(--brand-color)] mt-1">{fmtSmall(price)}</p>
        </div>
        <div className={`rounded-3xl border-2 p-5 text-center ${verdict.bg}`}>
          <span className="text-4xl" aria-hidden>{verdict.emoji}</span>
          <p className="mt-2 text-sm font-bold text-gray-500 uppercase tracking-wider">You keep</p>
          <p className={`text-3xl font-black mt-1 ${verdict.tone}`}>{fmtSmall(keep)}</p>
        </div>
      </div>

      <div className={`mt-5 rounded-2xl border-2 p-4 flex items-center gap-3 ${verdict.bg}`}>
        <span className="text-3xl" aria-hidden>{verdict.emoji}</span>
        <p className={`text-lg font-black ${verdict.tone}`}>{verdict.title}</p>
      </div>

      {rows.some((r) => r.needsReview) && (
        <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <CircleAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-base font-semibold text-amber-800">
            A few ingredients still need checking — go back to confirm them so the cost is correct.
          </p>
        </div>
      )}

      <div className="flex gap-3 mt-8">
        <button onClick={onBack} className="px-6 py-5 rounded-2xl border-2 border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-gray-600 text-lg font-black flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        <button
          onClick={onSave}
          disabled={saving || rows.filter((r) => r.inventoryItemId).length === 0}
          className="flex-1 py-6 rounded-2xl bg-[var(--color-emerald-500-solid)] hover:bg-[var(--color-emerald-600-solid)] text-white text-2xl font-black flex items-center justify-center gap-3 cursor-pointer transition-colors disabled:opacity-40 shadow-lg"
        >
          {saving ? <Loader2 className="w-8 h-8 animate-spin" /> : <Check className="w-8 h-8" />}
          {saving ? 'Saving…' : 'Save it! ✅'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 5 — DONE (big celebration, nothing more to read)
// ────────────────────────────────────────────────────────────────────
function DoneScreen({ product, savedCost, onAgain, onClose, selectedVariant }: {
  product: any;
  savedCost: any | null;
  onAgain: () => void;
  onClose: () => void;
  selectedVariant?: string;
}) {
  const variable = Number(savedCost?.estimatedVariableCost ?? savedCost?.recipeCost ?? 0);
  const contribution = Number(savedCost?.contribution ?? 0);
  return (
    <div className="max-w-xl mx-auto text-center mt-10">
      <div className="w-28 h-28 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
        <PartyPopper className="w-14 h-14 text-emerald-500" />
      </div>
      <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mt-6">Saved! 🎉</h2>
      <p className="text-xl text-gray-500 mt-3 font-semibold">
        {product.name}{selectedVariant ? ` (${selectedVariant})` : ''} is ready. Every time you sell it, the ingredients come off your stock automatically.
      </p>

      <div className="bg-[var(--color-bg-white)] rounded-3xl border-2 border-[var(--color-border-default)] p-6 mt-8 grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-wider">Cost to make</p>
          <p className="text-3xl font-black text-gray-900 mt-1">{fmtSmall(variable)}</p>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-wider">You keep</p>
          <p className={`text-3xl font-black mt-1 ${contribution >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtSmall(contribution)}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mt-8 justify-center">
        <button onClick={onAgain} className="py-5 px-8 rounded-2xl bg-[var(--brand-color)] text-white text-xl font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors">
          <Plus className="w-6 h-6" /> Make another
        </button>
        <button onClick={onClose} className="py-5 px-8 rounded-2xl border-2 border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-gray-700 text-xl font-black cursor-pointer hover:bg-gray-50 transition-colors">
          Done
        </button>
      </div>
    </div>
  );
}
